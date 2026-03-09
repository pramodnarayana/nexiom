import {
  Injectable,
  UnauthorizedException,
  Logger,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REDIS_CLIENT, type Redis } from '@nexiom/cache';
import * as crypto from 'node:crypto';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class OauthStateService {
  private readonly logger = new Logger(OauthStateService.name);
  private readonly jwtSecret: string;

  constructor(
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    const directStateSecret =
      this.configService.get<string>('OAUTH_STATE_SECRET');
    const masterJwtSecret = this.configService.get<string>('JWT_SECRET');

    if (directStateSecret) {
      this.jwtSecret = directStateSecret;
    } else if (masterJwtSecret) {
      // Derive a dedicated state signing key from the master JWT secret
      this.jwtSecret = crypto
        .createHmac('sha256', masterJwtSecret)
        .update('oauth_state')
        .digest('hex');
    } else {
      const nodeEnv = this.configService.get<string>('NODE_ENV');
      if (nodeEnv !== 'development' && nodeEnv !== 'test') {
        throw new Error(
          'FATAL: JWT_SECRET or OAUTH_STATE_SECRET must be provided in production',
        );
      }
      this.jwtSecret = 'nexiom-local-dev-oauth-state-secret-do-not-use-in-prod';
    }
  }

  /**
   * Generates a short-lived JWT containing the tenantId to be used as the OAuth `state` parameter.
   * This provides stateless CSRF protection and context continuity across the redirect boundary.
   */
  async generateState(
    tenantId: string,
    provider: string,
    vendorParams?: Record<string, string>,
  ): Promise<string> {
    const stateId = crypto.randomUUID();

    const payload: {
      tenantId: string;
      provider: string;
      purpose: string;
      stateId: string;
    } = {
      tenantId,
      provider,
      purpose: 'oauth_state_handshake',
      stateId,
    };

    if (vendorParams && Object.keys(vendorParams).length > 0) {
      await this.redis.set(
        `oauth:state:${stateId}`,
        JSON.stringify(vendorParams),
        'EX',
        15 * 60, // 15 minutes
      );
    }

    // State tokens exist simply to bridge the browser redirect.
    // A 10-15 minute expiry is plenty of time for a user to log in to Salesforce/HubSpot.
    return jwt.sign(payload, this.jwtSecret, { expiresIn: '15m' });
  }

  /**
   * Safely decodes the state token without verifying the signature
   * to extract just the provider name so the generic callback router
   * can look up the correct provider schema before full verification.
   */
  extractProviderFromState(stateToken: string): string {
    if (!stateToken) {
      throw new UnauthorizedException('Missing OAuth state token');
    }
    try {
      const raw = jwt.decode(stateToken);
      if (!raw || typeof raw === 'string' || !raw.provider) {
        throw new UnauthorizedException('Malformed OAuth state token');
      }
      return raw.provider as string;
    } catch (e) {
      if (e instanceof UnauthorizedException) {
        throw e;
      }
      throw new UnauthorizedException('Invalid OAuth state token format');
    }
  }

  /**
   * Verifies the OAuth state JWT and extracts the embedded tenantId.
   * Throws UnauthorizedException if the token is tampered with or expired.
   */
  async verifyState(
    stateToken: string,
    expectedProvider: string,
  ): Promise<{ tenantId: string; vendorParams?: Record<string, string> }> {
    if (!stateToken) {
      this.logger.error('OAuth state token is missing entirely');
      throw new UnauthorizedException('Missing OAuth state token');
    }

    try {
      const decoded = jwt.verify(stateToken, this.jwtSecret) as jwt.JwtPayload;

      if (decoded.purpose !== 'oauth_state_handshake') {
        this.logger.warn(`Invalid token purpose: ${decoded.purpose}`);
        throw new UnauthorizedException('Invalid OAuth state purpose');
      }

      if (decoded.provider !== expectedProvider) {
        this.logger.warn(
          `Provider mismatch in state token: Extracted ${decoded.provider}, Expected ${expectedProvider}`,
        );
        throw new UnauthorizedException('OAuth state provider mismatch');
      }

      if (!decoded.tenantId) {
        this.logger.warn('No tenantId embedded in the state token');
        throw new UnauthorizedException('Malformed OAuth state token');
      }

      if (!decoded.stateId) {
        this.logger.warn('No stateId embedded in the state token');
        throw new UnauthorizedException('Malformed OAuth state token');
      }

      const stateId = decoded.stateId as string;
      let vendorParams: Record<string, string> | undefined;

      const redisKey = `oauth:state:${stateId}`;
      const cachedParams = await this.redis.get(redisKey);

      if (cachedParams) {
        try {
          vendorParams = JSON.parse(cachedParams) as Record<string, string>;
        } catch {
          this.logger.warn(
            `Failed to parse cached vendor params for stateId ${stateId}`,
          );
        }
        await this.redis.del(redisKey);
      }

      return {
        tenantId: decoded.tenantId as string,
        vendorParams,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      if (error instanceof jwt.TokenExpiredError) {
        this.logger.warn('OAuth state token expired during handshake');
        throw new UnauthorizedException(
          'OAuth login window expired. Please try connecting again.',
        );
      }

      this.logger.error(
        'Failed to verify OAuth state JWT (Possible CSRF tampering attempt)',
        error,
      );
      throw new UnauthorizedException(
        'Invalid OAuth state. Potential CSRF detected.',
      );
    }
  }
}

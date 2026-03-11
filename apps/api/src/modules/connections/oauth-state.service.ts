import {
  Injectable,
  UnauthorizedException,
  Logger,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REDIS_CLIENT, type Redis } from '@nexiom/cache';
import * as crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

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
   * Generates a pre-flight session ID to hold sensitive OAuth connection parameters securely in Redis
   * before the browser redirect happens, preventing secrets from being leaked in the URL query string.
   */
  async createPreFlightSession(
    tenantId: string,
    userId: string,
    provider: string,
    clientId: string,
    vendorParams?: Record<string, any>,
  ): Promise<string> {
    const sessionId = crypto.randomUUID();
    const payload = JSON.stringify({
      tenantId,
      userId,
      provider,
      clientId,
      vendorParams,
    });

    // Sessions exist purely to bridge the gap between the form submission
    // and the popup opening (a few seconds). We use 10 minutes to be safe.
    await this.redis.set(`oauth:session:${sessionId}`, payload, 'EX', 10 * 60);
    return sessionId;
  }

  /**
   * Retrieves and immediately deletes a pre-flight session from Redis.
   * Throws UnauthorizedException if the session does not exist or has expired.
   */
  async consumePreFlightSession(sessionId: string): Promise<{
    tenantId: string;
    userId: string;
    provider: string;
    clientId: string;
    vendorParams?: Record<string, unknown>;
  }> {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new UnauthorizedException('Missing or invalid session ID');
    }

    const data = await this.redis.getdel(`oauth:session:${sessionId}`);

    if (!data) {
      throw new UnauthorizedException(
        'OAuth session expired or invalid. Please try connecting again.',
      );
    }

    try {
      return JSON.parse(data) as {
        tenantId: string;
        userId: string;
        provider: string;
        clientId: string;
        vendorParams?: Record<string, unknown>;
      };
    } catch {
      this.logger.error(
        `Failed to parse cached session data for sessionId ${sessionId}`,
      );
      throw new UnauthorizedException('Invalid OAuth session data.');
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

    await this.redis.set(
      `oauth:state:${stateId}`,
      vendorParams && Object.keys(vendorParams).length > 0
        ? JSON.stringify(vendorParams)
        : '{}', // Always persist a marker even for empty params
      'EX',
      15 * 60, // 15 minutes
    );

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
    consume = true,
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
        this.logger.debug(
          `verifyState: provider mismatch - decoded: ${decoded.provider}, expected: ${expectedProvider}`,
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
      const cachedParams = consume
        ? await this.redis.getdel(redisKey)
        : await this.redis.get(redisKey);

      if (!cachedParams) {
        this.logger.warn(
          `OAuth state marker for stateId ${stateId} was missing or already consumed (CSRF/Replay)`,
        );
        throw new UnauthorizedException(
          'OAuth login window expired or state already consumed',
        );
      }

      try {
        const parsed = JSON.parse(cachedParams) as Record<string, string>;
        if (Object.keys(parsed).length > 0) {
          vendorParams = parsed;
        }
      } catch {
        this.logger.warn(
          `Failed to parse cached vendor params for stateId ${stateId}`,
        );
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
      this.logger.debug('verifyState: catch block error', error);
      throw new UnauthorizedException(
        'Invalid OAuth state. Potential CSRF detected.',
      );
    }
  }
}

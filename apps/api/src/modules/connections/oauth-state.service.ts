import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class OauthStateService {
  private readonly logger = new Logger(OauthStateService.name);

  // In a real production system, this secret MUST be read from ConfigService/Env
  // Using a hardcoded fallback only for local scaffolding safety.
  private readonly jwtSecret =
    process.env.JWT_SECRET ||
    'nexiom-local-dev-oauth-state-secret-do-not-use-in-prod';

  /**
   * Generates a short-lived JWT containing the tenantId to be used as the OAuth `state` parameter.
   * This provides stateless CSRF protection and context continuity across the redirect boundary.
   */
  generateState(tenantId: string, provider: string): string {
    const payload = {
      tenantId,
      provider,
      purpose: 'oauth_state_handshake',
    };

    // State tokens exist simply to bridge the browser redirect.
    // A 10-15 minute expiry is plenty of time for a user to log in to Salesforce/HubSpot.
    return jwt.sign(payload, this.jwtSecret, { expiresIn: '15m' });
  }

  /**
   * Verifies the OAuth state JWT and extracts the embedded tenantId.
   * Throws UnauthorizedException if the token is tampered with or expired.
   */
  verifyState(
    stateToken: string,
    expectedProvider: string,
  ): { tenantId: string } {
    if (!stateToken) {
      this.logger.error('OAuth state token is missing entirely');
      throw new UnauthorizedException('Missing OAuth state token');
    }

    try {
      const decoded = jwt.verify(stateToken, this.jwtSecret) as jwt.JwtPayload;

      if (decoded.purpose !== 'oauth_state_handshake') {
        this.logger.error(`Invalid token purpose: ${decoded.purpose}`);
        throw new UnauthorizedException('Invalid OAuth state purpose');
      }

      if (decoded.provider !== expectedProvider) {
        this.logger.error(
          `Provider mismatch in state token: Extracted ${decoded.provider}, Expected ${expectedProvider}`,
        );
        throw new UnauthorizedException('OAuth state provider mismatch');
      }

      if (!decoded.tenantId) {
        this.logger.error('No tenantId embedded in the state token');
        throw new UnauthorizedException('Malformed OAuth state token');
      }

      return { tenantId: decoded.tenantId as string };
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

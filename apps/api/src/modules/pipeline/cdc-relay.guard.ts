import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CdcRelayGuard implements CanActivate {
  private readonly logger = new Logger(CdcRelayGuard.name);
  private readonly disableAuth: boolean;

  constructor(private readonly config: ConfigService) {
    // Explicit opt-in flag for disabling auth (replaces NODE_ENV check)
    this.disableAuth = this.config.get<boolean>('CDC_RELAY_DISABLE_AUTH', false);
    if (this.disableAuth) {
      this.logger.warn('CDC_RELAY_DISABLE_AUTH is enabled - authentication bypass is active');
    }
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
    }>();
    const expectedSecret = this.config.get<string>('DEBEZIUM_SECRET');

    // Explicit opt-in auth bypass (controlled by CDC_RELAY_DISABLE_AUTH flag)
    if (this.disableAuth) {
      return true;
    }

    if (!expectedSecret) {
      throw new UnauthorizedException('DEBEZIUM_SECRET is not configured');
    }

    const authHeader = req.headers.authorization;
    const customHeader = req.headers['x-debezium-auth'];

    // Only accept standard "Bearer <token>" format (with space)
    if (
      authHeader !== `Bearer ${expectedSecret}` &&
      customHeader !== expectedSecret
    ) {
      // Log failure without exposing the secret
      this.logger.error('CDC Relay Auth failed:', {
        authHeader,
        customHeader,
      });
      throw new UnauthorizedException('Invalid CDC relay authorization');
    }

    return true;
  }
}

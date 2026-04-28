import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CdcRelayGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      query: Record<string, string | undefined>;
    }>();
    const expectedSecret = this.config.get<string>('DEBEZIUM_SECRET');

    if (!expectedSecret) {
      throw new UnauthorizedException('DEBEZIUM_SECRET is not configured');
    }

    const authHeader = req.headers.authorization;
    const customHeader = req.headers['x-debezium-auth'];
    const queryToken = req.query?.token;

    if (
      authHeader !== `Bearer ${expectedSecret}` &&
      customHeader !== expectedSecret &&
      queryToken !== expectedSecret
    ) {
      throw new UnauthorizedException('Invalid CDC relay authorization');
    }

    return true;
  }
}

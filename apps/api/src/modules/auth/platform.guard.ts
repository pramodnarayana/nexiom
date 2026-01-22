import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { IdentityProvider } from './identity-provider.abstract';
import { Request } from 'express';
import { toWebHeaders } from '../../shared/utils/headers.util';

/**
 * PlatformGuard
 *
 * Allows both platform_admin and platform_user roles.
 * Use this guard for read-only operations (GET endpoints).
 *
 * For write operations (POST, PATCH, DELETE), use SystemAdminGuard instead.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly authProvider: IdentityProvider) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    // Validate Session via Headers (Correctly handles Signed Cookies)
    const headers = toWebHeaders(req.headers);
    const sessionData = await this.authProvider.getSessionFromHeaders(headers);

    if (!sessionData) {
      throw new UnauthorizedException('Invalid Session');
    }

    // Check System Role - Allow both platform_admin and platform_user
    const user = sessionData.user as { systemRole?: string };

    if (
      user.systemRole !== 'platform_admin' &&
      user.systemRole !== 'platform_user'
    ) {
      throw new ForbiddenException('Requires Platform Access');
    }

    // Attach User to Request for Controller usage
    (req as Request & { user: unknown }).user = user;
    return true;
  }
}

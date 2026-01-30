import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { Request } from 'express';
import { toWebHeaders } from '../../../common/utils/headers.util';

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
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    // Validate Session via Headers (Correctly handles Signed Cookies)
    const headers = toWebHeaders(req.headers);
    const sessionData = await this.authService.getSessionFromHeaders(headers);

    if (!sessionData?.user) {
      throw new UnauthorizedException('Invalid Session');
    }

    // Check System Permissions (Read Access)
    const user = sessionData.user;
    const hasAccess = await this.authService.hasSystemPermission(user, 'view');

    if (!hasAccess) {
      throw new ForbiddenException('Requires Platform Access');
    }

    // Attach User to Request for Controller usage
    (req as Request & { user: unknown }).user = user;
    return true;
  }
}

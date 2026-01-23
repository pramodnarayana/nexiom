import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { Request } from 'express';
import { toWebHeaders } from '../../shared/utils/headers.util';
import { PERMISSION_PROVIDER, IPermissionProvider } from '@nexiom/identity';

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
  constructor(
    private readonly authService: AuthService,
    @Inject(PERMISSION_PROVIDER)
    private readonly permissionProvider: IPermissionProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    // Validate Session via Headers (Correctly handles Signed Cookies)
    const headers = toWebHeaders(req.headers);
    const sessionData = await this.authService.getSessionFromHeaders(headers);

    if (!sessionData) {
      throw new UnauthorizedException('Invalid Session');
    }

    // Check System Role - Allow both platform_admin and platform_user
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const user = sessionData.user;
    const isPlatformAdmin = await this.permissionProvider.hasRole(
      user,
      'platform_admin',
    );
    const isPlatformUser = await this.permissionProvider.hasRole(
      user,
      'platform_user',
    );

    if (!isPlatformAdmin && !isPlatformUser) {
      throw new ForbiddenException('Requires Platform Access');
    }

    // Attach User to Request for Controller usage
    (req as Request & { user: unknown }).user = user;
    return true;
  }
}

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthService, type RequestAuthContext } from '@soopa/auth';
import { Request } from 'express';
import { toWebHeaders } from '../../../common/utils/headers.util.js';

@Injectable()
export class SystemAdminGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    // 1. Validate Session via Headers (Correctly handles Signed Cookies)
    const headers = toWebHeaders(req.headers);
    const sessionData = await this.authService.getSessionFromHeaders(headers);

    if (!sessionData) {
      throw new UnauthorizedException('Invalid Session');
    }

    // 3. Check System Permissions
    // Note: sessionData.user comes from Drizzle Schema via IdentityProvider.
    const user = sessionData.user;
    const hasAccess = await this.authService.hasSystemPermission(
      user,
      'manage',
    );

    if (!hasAccess) {
      throw new ForbiddenException('Requires Platform Admin Privileges');
    }

    // 4. Attach User to Request for Controller usage
    // We explicitly DO NOT attach a "Tenant" here to prevent accidental leakage.
    const reqWithAuth = req as Request & {
      user: unknown;
      authContext: RequestAuthContext;
    };
    reqWithAuth.user = user;
    reqWithAuth.authContext = {
      headers,
      user,
      session: sessionData.session,
    };
    return true;
  }
}

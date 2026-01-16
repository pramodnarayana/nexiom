import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { IdentityProvider } from './identity-provider.abstract';
import { Request } from 'express';

@Injectable()
export class SystemAdminGuard implements CanActivate {
  constructor(private readonly authProvider: IdentityProvider) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    // 1. Extract Token (Similar to AuthGuard but isolated logic)
    // 1. Validate Session via Headers (Correctly handles Signed Cookies)
    const headers = new Headers(req.headers as Record<string, string>);
    const sessionData = await this.authProvider.getSessionFromHeaders(headers);

    if (!sessionData) {
      throw new UnauthorizedException('Invalid Session');
    }

    // 3. Check System Role
    // Note: sessionData.user comes from Drizzle Schema via IdentityProvider.
    // We cast to a minimal interface that includes systemRole
    const user = sessionData.user as { systemRole?: string };

    if (user.systemRole !== 'platform_admin') {
      throw new ForbiddenException('Requires Platform Admin Privileges');
    }

    // 4. Attach User to Request for Controller usage
    // We explicitly DO NOT attach a "Tenant" here to prevent accidental leakage.
    (req as Request & { user: unknown }).user = user;
    return true;
  }
}

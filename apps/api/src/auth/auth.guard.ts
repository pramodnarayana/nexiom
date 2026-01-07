import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { IdentityProvider } from './identity-provider.abstract';

import { Request } from 'express';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authProvider: IdentityProvider) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: unknown; session: unknown }>();

    // 1. Extract session token (Prioritize Cookie, then Bearer)
    // Accessing cookies in NestJS requires 'cookie-parser' which we added to main.ts

    const reqWithCookies = request as Request & {
      cookies: Record<string, string>;
    };
    const authHeader = request.headers['authorization'];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const token: string | undefined =
      reqWithCookies.cookies?.['better-auth.session_token'] ||
      this.extractTokenFromHeader(authHeader);

    if (!token) {
      throw new UnauthorizedException('No session token provided');
    }

    // 2. Validate Session using robust enriched method
    const result: { session: unknown; user: unknown } | null =
      await this.authProvider.getEnrichedSession(token);

    if (!result || !result.session || !result.user) {
      throw new UnauthorizedException('Invalid session'); // Or call validateSession fallback if needed, but getEnriched should wrap it.
    }

    // Unwrap for attaching to request (keeping local vars consistent with previous structure for minimal diff)
    const { user, session } = result;

    if (!session || !user) {
      throw new UnauthorizedException('Invalid session');
    }

    // 3. Attach to request
    request.user = user;
    request.session = session;

    return true;
  }

  private extractTokenFromHeader(
    request: string | undefined,
  ): string | undefined {
    const [type, token] = request?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}

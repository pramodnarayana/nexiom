import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

import { Request } from 'express';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: unknown; session: unknown }>();

    // 1. Validate Session using robust enriched method via Headers (handles Signed Cookies)
    // We pass the raw Node headers to the adapter, which handles conversion safely
    // 2. Validate Token logic
    try {
      const sessionData = await this.authService.getSessionFromHeaders(
        request.headers,
      );

      if (!sessionData || typeof sessionData.session?.token !== 'string') {
        throw new UnauthorizedException('Invalid or Expired Session');
      }

      const enrichedResult = await this.authService.getEnrichedSession(
        sessionData.session.token,
      );

      if (!enrichedResult) {
        throw new UnauthorizedException(
          'Session extraction failed during enrichment',
        );
      }

      // Unwrap for attaching to request
      const { user, session } = enrichedResult;

      // 3. Attach to request
      // We attach the ENRICHED user/session, not the basic one.
      request.user = user;
      request.session = session;

      console.log(
        `[AuthGuard] Session Validated for User: ${user?.id}, SessionID: ${session?.id}`,
      );
      return true;
    } catch (error) {
      console.error('[AuthGuard] Error validating session:', error);
      throw error;
    }
  }
}

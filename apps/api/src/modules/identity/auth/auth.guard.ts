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
    // We convert Express headers to Web Standard Headers
    const headers = new Headers(request.headers as Record<string, string>);

    // 2. Validate Token logic
    const sessionData = await this.authService.getSessionFromHeaders(headers);

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

    return true;
  }
}

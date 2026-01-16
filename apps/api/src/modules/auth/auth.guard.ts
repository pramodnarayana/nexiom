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

    // 1. Validate Session using robust enriched method via Headers (handles Signed Cookies)
    // We convert Express headers to Web Standard Headers
    const headers = new Headers(request.headers as Record<string, string>);

    // Use the new provider method that delegates to Better Auth
    const result = await this.authProvider.getSessionFromHeaders(headers);

    if (!result) {
      throw new UnauthorizedException('Invalid or Expired Session');
    }

    // We still want to enrich it if getSessionFromHeaders uses basic validateSession?
    // In BetterAuthIdentityProvider.getSessionFromHeaders, we return { session, user }.
    // But getEnrichedSession ADDS tenant info (`hasTenant`, `organizationId`).
    // getSessionFromHeaders (via BetterAuth API) returns standard session.
    // We need to ENRICH it afterwards if the user is logged in.

    // Wait. getSessionFromHeaders returns the BASIC session.
    // AuthGuard usually provides tenant info.
    // So we must call getEnrichedSession using the raw token we just got back from getSessionFromHeaders.

    const enrichedResult = await this.authProvider.getEnrichedSession(
      result.session.token,
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

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { AuthService } from "../services/auth.service.js";

import { Request } from "express";
import { toWebHeaders } from "../utils/headers.util.js";
import { RequestAuthContext } from "../decorators/auth-context.decorator.js";

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<
      Request & {
        user: unknown;
        session: unknown;
        authContext?: RequestAuthContext;
      }
    >();

    // 1. Validate Session using robust enriched method via Headers (handles Signed Cookies)
    // We pass the raw Node headers to the adapter, which handles conversion safely
    // 2. Validate Token logic
    try {
      const sessionData = await this.authService.getSessionFromHeaders(
        request.headers,
      );

      if (!sessionData || typeof sessionData.session?.token !== "string") {
        throw new UnauthorizedException("Invalid or Expired Session");
      }

      const enrichedResult = await this.authService.getEnrichedSession(
        sessionData.session.token,
      );

      if (!enrichedResult) {
        throw new UnauthorizedException(
          "Session extraction failed during enrichment",
        );
      }

      // Unwrap for attaching to request
      const { user, session } = enrichedResult;

      // 3. Attach to request
      // We attach the ENRICHED user/session, not the basic one.
      const webHeaders = toWebHeaders(request.headers);
      request.user = user;
      request.session = session;
      request.authContext = { headers: webHeaders, user, session };

      this.logger.debug(
        `[AuthGuard] Session Validated for User: ${user?.id}, SessionID: ${session?.id}`,
      );
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error(
        `[AuthGuard] Error validating session: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }
}

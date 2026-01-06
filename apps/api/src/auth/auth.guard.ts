import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { IdentityProvider } from './identity-provider.abstract';

@Injectable()
export class AuthGuard implements CanActivate {
    constructor(private readonly authProvider: IdentityProvider) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();

        // 1. Extract session token (Prioritize Cookie, then Bearer)
        // Accessing cookies in NestJS requires 'cookie-parser' which we added to main.ts
        const token = request.cookies?.['better-auth.session_token'] || this.extractTokenFromHeader(request.headers.authorization as string | undefined);

        if (!token) {
            throw new UnauthorizedException('No session token provided');
        }

        // 2. Validate Session using robust enriched method
        const result = await this.authProvider.getEnrichedSession(token);

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

    private extractTokenFromHeader(request: string | undefined): string | undefined {
        const [type, token] = request?.split(' ') ?? [];
        return type === 'Bearer' ? token : undefined;
    }
}

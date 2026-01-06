import { Controller, Post, Body, Res, All, Req, UnauthorizedException } from '@nestjs/common';
import { IdentityProvider } from './identity-provider.abstract';
import { BetterAuthIdentityProvider } from './better-auth.provider'; // Import concrete class for handler access
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { Signup } from './users/users.schema';
import { Response, Request } from 'express';
import { toNodeHandler } from 'better-auth/node';

export class Login extends createZodDto(z.object({
    email: z.string().email(),
    password: z.string(),
})) { }

/**
 * Handles authentication-related operations such as user login.
 */
import { User, Session } from '../schema/better-auth';

// ... (imports)

@Controller('auth')
export class AuthController {
    constructor(private readonly authProvider: IdentityProvider) { }

    @Post('login')
    async login(@Body() login: Login): Promise<{ session: Session; user: User }> {
        const result = await this.authProvider.login(login.email, login.password);
        return result;
    }

    @Post('signup')
    async signup(@Body() body: Signup): Promise<User> {
        return this.authProvider.createUser(body);
    }

    /**
     * Endpoint to Auto-Provision a tenant for an existing user (e.g. via Social Login).
     * This is called by the frontend if the user is detected to have no organization.
     */
    @Post('provision-tenant')
    async provisionTenant(@Req() req: Request): Promise<unknown> {
        // Extract session from cookie or header (Better Auth middleware handles this ideally, 
        // but for now we trust the AuthGuard or just pass it if using custom logic)
        // Actually, AuthGuard should populate req.user (if we set it up that way).
        // For this specific flow, we are relying on session validation.

        const betterAuth = this.authProvider as BetterAuthIdentityProvider;

        // PRIORITY FIX: Prefer the Cookie because it contains the Signature (signed token).
        // The Bearer token from frontend is often raw (unsigned), which fails cookie emulation.
        const authHeader = req.headers['authorization'] as string | undefined;
        const token = req.cookies?.['better-auth.session_token'] || authHeader?.split(' ')[1] || '';

        console.log(`[ProvisionTenant] Headers Auth: ${req.headers['authorization']}`);
        console.log(`[ProvisionTenant] Cookie Token: ${req.cookies?.['better-auth.session_token']}`);
        console.log(`[ProvisionTenant] Using Token: ${token}`);

        const session = await betterAuth.validateSession(token);
        console.log(`[ProvisionTenant] Session Valid? ${!!session}`);

        if (!session) {
            throw new UnauthorizedException('No Session Found');
        }

        return betterAuth.provisionTenant(session.user.id);
    }

    /**
     * Reliable endpoint to get the session WITH organization data.
     * Bypasses the standard /auth/get-session which might ignore custom hooks.
     */
    @Post('refresh-session')
    async refreshSession(@Req() req: Request) {
        // Extract Token (Prioritize Cookie)
        const authHeader = req.headers['authorization'] as string | undefined;
        const token = req.cookies?.['better-auth.session_token'] || authHeader?.split(' ')[1] || '';
        if (!token) throw new UnauthorizedException('No token provided');

        // Use the standard interface method
        const session = await this.authProvider.getEnrichedSession(token);
        if (!session) throw new UnauthorizedException('Invalid Session');

        return session;
    }

    /**
     * Catch-All route for standard Better Auth endpoints.
     * Handles /auth/sign-in/social, /auth/callback/*, etc.
     * Uses '*splat' (RegExp compatible) to match any path.
     */
    @All('*splat')
    async betterAuth(@Req() req: Request, @Res() res: Response) {
        console.log('Better Auth Catch-All Hit:', {
            method: req.method,
            url: req.url,
            originalUrl: req.originalUrl,
            params: req.params
        });
        const betterAuth = this.authProvider as BetterAuthIdentityProvider;
        const handler = betterAuth.getHandler();

        // Convert Better Auth's standard web handler to Node (Express) handler
        return toNodeHandler(handler)(req, res);
    }
}

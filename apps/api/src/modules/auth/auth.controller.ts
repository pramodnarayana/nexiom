import {
  Controller,
  Post,
  Body,
  Res,
  All,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { IdentityProvider } from './identity-provider.abstract';
import { TenantsService } from '../tenants/tenants.service';
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { Signup } from '../users/users.validation';
import { Response, Request } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { User } from '../users/user.schema';
import { Session } from './auth.schema';

/**
 * Handles authentication-related operations such as user login.
 */

export class Login extends createZodDto(
  z.object({
    email: z.string().email(),
    password: z.string(),
  }),
) {}

// ... (imports)

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authProvider: IdentityProvider,
    private readonly tenantsService: TenantsService,
  ) {}

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
    // Extract session from cookie or header
    // PRIORITY FIX: Prefer the Cookie because it contains the Signature (signed token).
    // The Bearer token from frontend is often raw (unsigned), which fails cookie emulation.
    const authHeader = req.headers['authorization'];

    const reqWithCookies = req as Request & { cookies: Record<string, string> };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const token: string =
      reqWithCookies.cookies?.['better-auth.session_token'] ||
      authHeader?.split(' ')[1] ||
      '';

    const session: { user: { id: string }; session: unknown } | null =
      await this.authProvider.validateSession(token);

    if (!session) {
      throw new UnauthorizedException('No Session Found');
    }

    return this.tenantsService.provisionTenantForUser(session.user.id);
  }

  /**
   * Reliable endpoint to get the session WITH organization data.
   * Bypasses the standard /auth/get-session which might ignore custom hooks.
   */
  @Post('refresh-session')
  async refreshSession(@Req() req: Request) {
    // Extract Token (Prioritize Cookie)
    const authHeader = req.headers['authorization'];

    const reqWithCookies = req as Request & { cookies: Record<string, string> };

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const token: string =
      reqWithCookies.cookies?.['better-auth.session_token'] ||
      authHeader?.split(' ')[1] ||
      '';
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const handler = this.authProvider.getHandler();

    // Convert Better Auth's standard web handler to Node (Express) handler
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return toNodeHandler(handler)(req, res);
  }
}

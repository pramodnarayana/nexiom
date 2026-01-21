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
import { Signup, CompleteInvite } from '../users/users.validation';
import { Response, Request } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { User } from '../users/user.schema';
import { InvitationsService } from '../invitations/invitations.service';
import { Session } from './auth.schema';
import { toWebHeaders } from '../../shared/utils/headers.util';
import { BadRequestException } from '@nestjs/common';

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
    private readonly invitationsService: InvitationsService,
  ) {}

  @Post('login')
  async login(
    @Body() login: Login,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ session: Session; user: User }> {
    const { cookie: loginCookie, ...result } = await this.authProvider.login(
      login.email,
      login.password,
    );

    // MANUAL COOKIE SETTING (Critical Fix - Using Library's Native Cookie)
    // We captured the exact Set-Cookie header from Better Auth.
    // This ensures signature, path, and attributes are exactly what the library expects.
    if (loginCookie) {
      res.setHeader('Set-Cookie', loginCookie);
    }

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
    // FIX: use getSessionFromHeaders to handle signed cookies correctly
    const sessionData = await this.authProvider.getSessionFromHeaders(
      toWebHeaders(req.headers),
    );

    if (!sessionData) {
      throw new UnauthorizedException('No Session Found');
    }

    return this.tenantsService.provisionTenantForUser(sessionData.user.id);
  }

  @Post('complete-invite')
  async completeInvite(
    @Body() body: CompleteInvite,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    // Race Condition Fix: Validate Invitation BEFORE creating user
    const invitation = (await this.invitationsService.get(
      body.invitationId,
      req.headers,
    )) as { status: string; expiresAt: Date } | null;

    if (!invitation) {
      throw new BadRequestException('Invalid Invitation ID');
    }

    if (invitation.status !== 'pending') {
      throw new BadRequestException('Invitation is no longer pending/valid');
    }

    if (new Date(invitation.expiresAt) < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }

    // Step 1: Check if user exists (Provisioned vs New)
    // console.log('[DEBUG] completeInvite: Headers received:', Object.keys(req.headers));
    let user = await this.authProvider.getUserByEmail(body.email);

    if (user) {
      if (user.emailVerified) {
        throw new BadRequestException(
          'User is already registered. Please log in.',
        );
      }
      // Update existing provisioned user
      user = await this.authProvider.updateUser(user.id, {
        name: `${body.firstName} ${body.lastName}`,
      });
      await this.authProvider.setPassword(user.id, body.password);
    } else {
      // Create new user (standard flow)
      user = await this.authProvider.createUser(
        {
          email: body.email,
          password: body.password,
          firstName: body.firstName,
          lastName: body.lastName,
          role: 'user',
        },
        req.headers,
      );
    }

    // Step 2: Accept Invitation (Atomic-ish)
    try {
      await this.invitationsService.accept(
        body.invitationId,
        user.id,
        req.headers,
      );
    } catch (_e) {
      // Rollback: Delete the user if acceptance fails to prevent orphans
      await this.authProvider.deleteUser(user.id);
      throw new BadRequestException(
        'Failed to accept invitation (User creation rolled back)',
      );
    }

    // Step 3: Force Verify Email
    await this.authProvider.forceVerifyEmail(user.id);

    // Step 4: Login & Return Session
    const { cookie: loginCookie, ...session } = await this.authProvider.login(
      body.email,
      body.password,
    );

    // FIX: Forward the Set-Cookie header so the user stays logged in
    if (loginCookie) {
      res.setHeader('Set-Cookie', loginCookie);
    }

    return session;
  }

  /**
   * Reliable endpoint to get the session WITH organization data.
   * Bypasses the standard /auth/get-session which might ignore custom hooks.
   */
  @Post('refresh-session')
  async refreshSession(@Req() req: Request) {
    // Delegate session extraction to the provider (handles signed cookies/headers)
    // We pass the native Headers object
    const sessionData = await this.authProvider.getSessionFromHeaders(
      toWebHeaders(req.headers),
    );

    if (!sessionData) {
      throw new UnauthorizedException('Invalid Session');
    }

    // Now Enrich it (we have the valid session object)
    // We can use getEnrichedSession, but we already have the session object.
    // Let's refactor getEnrichedSession to accept an OBJECT or ID?
    // Or just call getEnrichedSession with the now-valid session ID.
    return this.authProvider.getEnrichedSession(sessionData.session.token);
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

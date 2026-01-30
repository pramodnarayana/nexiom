import {
  Controller,
  Post,
  Body,
  Res,
  All,
  Req,
  UnauthorizedException,
  Inject,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  USER_PROVIDER,
  IUserProvider,
  Session,
  User,
  TENANT_PROVIDER,
  ITenantProvider,
} from '@nexiom/identity';
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { Signup, CompleteInvite } from '../users/users.validation';
import { Response, Request } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { InvitationsService } from '../invitations/invitations.service';
import { toWebHeaders } from '../../../shared/utils/headers.util';

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
    private readonly authService: AuthService,
    @Inject(USER_PROVIDER) private readonly userProvider: IUserProvider,
    @Inject(TENANT_PROVIDER) private readonly tenantProvider: ITenantProvider,
    private readonly invitationsService: InvitationsService,
  ) {}

  private readonly logger = new Logger(AuthController.name);

  @Post('login')
  async login(
    @Body() login: Login,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ session: Session; user: User }> {
    const { cookie: loginCookie, ...result } =
      await this.authService.login(login);

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
    return this.authService.createUser(body);
  }

  /**
   * Endpoint to Auto-Provision a tenant for an existing user (e.g. via Social Login).
   * This is called by the frontend if the user is detected to have no organization.
   */
  @Post('provision-tenant')
  async provisionTenant(@Req() req: Request): Promise<unknown> {
    // FIX: use getSessionFromHeaders to handle signed cookies correctly
    const sessionData = await this.authService.getSessionFromHeaders(
      toWebHeaders(req.headers),
    );

    if (!sessionData) {
      throw new UnauthorizedException('No Session Found');
    }

    return this.tenantProvider.provisionTenantForUser(sessionData.user.id);
  }

  /**
   * Completes an invitation by creating a user (if needed), accepting the invite,
   * verifying email, and logging the user in.
   */
  @Post('complete-invite')
  async completeInvite(
    @Body() body: CompleteInvite,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Race Condition Fix: Validate Invitation BEFORE creating user
    const invitation = await this.invitationsService.get(body.invitationId);

    if (!invitation) {
      throw new BadRequestException('Invalid Invitation ID');
    }
    // ...
    if (invitation.status !== 'pending') {
      throw new BadRequestException('Invitation is no longer pending/valid');
    }

    if (new Date(invitation.expiresAt) < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }

    // Step 1: Check if user exists (Provisioned vs New)
    let user = await this.userProvider.findByEmail(body.email);
    let isNewUser = false;

    if (user) {
      if (user.emailVerified) {
        throw new BadRequestException(
          'User is already registered. Please log in.',
        );
      }
      // Update existing provisioned user
      user = await this.userProvider.update(user.id, {
        name: `${body.firstName} ${body.lastName}`,
      });
      await this.authService.setPassword(user.id, body.password);
    } else {
      // Create new user (standard flow)
      isNewUser = true;
      user = await this.authService.createUser({
        email: body.email,
        password: body.password,
        firstName: body.firstName,
        lastName: body.lastName,
        role: 'user',
      });
    }

    // Step 2: Accept Invitation (Atomic-ish)
    try {
      await this.invitationsService.accept(body.invitationId, user.id);
    } catch (error) {
      this.logger.error(`Failed to accept invitation: ${String(error)}`);
      if (isNewUser) {
        if (user?.id) await this.userProvider.delete(user.id);
      }
      throw new BadRequestException(
        'Failed to accept invitation' +
          (isNewUser ? ' (User creation rolled back)' : ''),
        { cause: error },
      );
    }

    // Step 3: Force Verify Email
    await this.userProvider.forceVerifyEmail(user.id);

    // Step 4: Login & Return Session
    const { cookie: loginCookie, ...session } = await this.authService.login({
      email: body.email,
      password: body.password,
    });

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
    const sessionData = await this.authService.getSessionFromHeaders(
      toWebHeaders(req.headers),
    );

    if (!sessionData) {
      throw new UnauthorizedException('Invalid Session');
    }

    // Now Enrich it (we have the valid session object)
    // We can use getEnrichedSession, but we already have the session object.
    // Let's refactor getEnrichedSession to accept an OBJECT or ID?
    // Or just call getEnrichedSession with the now-valid session ID.
    return this.authService.getEnrichedSession(sessionData.session.token);
  }

  /**
   * Catch-All route for standard Better Auth endpoints.
   * Handles /auth/sign-in/social, /auth/callback/*, etc.
   * Uses '*splat' (RegExp compatible) to match any path.
   */
  @All('*splat')
  async betterAuth(@Req() req: Request, @Res() res: Response) {
    this.logger.log(`BetterAuth Request: ${req.method} ${req.url}`);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const handler = this.authService.getHandler();

    // Convert Better Auth's standard web handler to Node (Express) handler
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return toNodeHandler(handler)(req, res);
  }
}

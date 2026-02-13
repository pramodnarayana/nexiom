import {
  Controller,
  Post,
  Body,
  Res,
  All,
  Req,
  Inject,
  Logger,
  BadRequestException,
  UseGuards,
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
import { AuthGuard } from './auth.guard';
import { AuthContext } from './auth-context.decorator';

/**
 * Handles authentication-related operations such as user login.
 */

export class Login extends createZodDto(
  z.object({
    email: z.string().email(),
    password: z.string(),
  }),
) {}

export class ResendVerificationDto extends createZodDto(
  z.object({
    email: z.string().email(),
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
    return this.authService.registerUser(body);
  }

  /**
   * Endpoint to Auto-Provision a tenant for an existing user (e.g. via Social Login).
   * This is called by the frontend if the user is detected to have no organization.
   */
  @Post('provision-tenant')
  @UseGuards(AuthGuard)
  async provisionTenant(@AuthContext('user') user: User): Promise<unknown> {
    return this.tenantProvider.provisionTenantForUser(user.id);
  }

  /**
   * Resend verification email for a user
   */
  @Post('resend-verification')
  async resendVerification(
    @Body() body: ResendVerificationDto,
  ): Promise<{ message: string }> {
    try {
      await this.authService.resendVerificationEmail(body.email);
      return { message: 'Verification email sent successfully' };
    } catch (error) {
      this.logger.error('Failed to resend verification email', error);
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Failed to send verification email',
      );
    }
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
    this.logger.log(`[CompleteInvite] Received request for ${body.email}`);
    this.logger.debug(
      `[CompleteInvite] Payload: invitationId=${body.invitationId}, firstName=${body.firstName}, lastName=${body.lastName}`,
    );

    // Race Condition Fix: Validate Invitation BEFORE creating user
    const invitation = await this.invitationsService.get(body.invitationId);

    if (!invitation) {
      this.logger.warn(
        `[CompleteInvite] Invalid Invitation ID: ${body.invitationId}`,
      );
      throw new BadRequestException('Invalid Invitation ID');
    }

    this.logger.debug(
      `[CompleteInvite] Found invitation: ${invitation.id}, status: ${invitation.status}`,
    );

    if (invitation.status !== 'pending') {
      this.logger.warn(
        `[CompleteInvite] Invitation not pending: ${invitation.status}`,
      );
      throw new BadRequestException('Invitation is no longer pending/valid');
    }

    if (new Date(invitation.expiresAt) < new Date()) {
      const expiryLog = new Date(invitation.expiresAt).toISOString();
      this.logger.warn(`[CompleteInvite] Invitation expired: ${expiryLog}`);
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
      // Create new user (PURE FLOW - No Auto Provisioning)
      isNewUser = true;
      // We use createUser (Identity Only) because the Invite flow handles organization membership separately.
      // This prevents the "Double Organization" bug.
      user = await this.authService.createUser({
        email: body.email,
        password: body.password,
        firstName: body.firstName,
        lastName: body.lastName,
        role: 'member',
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
  @UseGuards(AuthGuard)
  async refreshSession(@AuthContext('session') session: Session) {
    return this.authService.getEnrichedSession(session.token);
  }

  /**
   * Catch-All route for standard Better Auth endpoints.
   * Handles /auth/sign-in/social, /auth/callback/*, etc.
   * Uses '*splat' (RegExp compatible) to match any path.
   */
  @All('*splat')
  async betterAuth(@Req() req: Request, @Res() res: Response) {
    this.logger.debug(`BetterAuth Request: ${req.method} ${req.path}`);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const handler = this.authService.getHandler();

    // Convert Better Auth's standard web handler to Node (Express) handler
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return toNodeHandler(handler)(req, res);
  }
}

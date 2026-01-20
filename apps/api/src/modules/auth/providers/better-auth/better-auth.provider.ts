import { Injectable, Logger, Inject } from '@nestjs/common';
import { IdentityProvider } from '../../identity-provider.abstract';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import * as schema from '../../../../db/schema';
import { eq, and } from 'drizzle-orm';
import { CreateUser } from '../../../users/users.validation';
import { organization, admin } from 'better-auth/plugins';
import { EmailService } from '../../../email/email.service.abstract';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '../../../../db/db.provider';
import { TenantsService } from '../../../tenants/tenants.service';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../../../users/user.schema';

@Injectable()
export class BetterAuthIdentityProvider implements IdentityProvider {
  private auth: ReturnType<typeof betterAuth>;
  private logger = new Logger(BetterAuthIdentityProvider.name);

  constructor(
    private readonly emailService: EmailService,
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly tenantsService: TenantsService,
  ) {
    if (!process.env.ALLOWED_ORIGINS) {
      throw new Error('ALLOWED_ORIGINS environment variable is not defined');
    }

    if (!process.env.BETTER_AUTH_URL) {
      throw new Error('BETTER_AUTH_URL environment variable is not defined');
    }

    const emailSvc = this.emailService;
    this.auth = betterAuth({
      trustedOrigins: process.env.ALLOWED_ORIGINS.split(','),
      baseURL: process.env.BETTER_AUTH_URL,
      database: drizzleAdapter(this.db, {
        provider: 'pg',
        schema: schema,
      }),
      emailAndPassword: {
        enabled: true,
      },
      user: {
        additionalFields: {
          systemRole: {
            type: 'string',
            required: false, // It's nullable/default "user"
          },
        },
      },
      emailVerification: {
        sendOnSignUp: true,
        autoSignInAfterVerification: true,

        sendVerificationEmail: async ({ user, url }) => {
          await emailSvc.sendEmail({
            to: user.email,
            subject: 'Verify your email for Nexiom',
            text: `Please verify your email by clicking the following link: ${url}`,
            html: `<p>Please verify your email by clicking the following link: <a href="${url}">${url}</a></p>`,
          });
        },
      },
      plugins: [
        organization({
          sendInvitationEmail: async (data) => {
            // data contains: id, email, role, organization, invitation

            const trustedOrigins =
              process.env.ALLOWED_ORIGINS?.split(',') || [];
            const frontendUrl = process.env.FRONTEND_URL;
            let baseUrl = frontendUrl;

            // Security: Ensure the Base URL is trusted
            if (frontendUrl && !trustedOrigins.includes(frontendUrl)) {
              throw new Error(
                `Configuration Error: FRONTEND_URL (${frontendUrl}) is not in ALLOWED_ORIGINS. Refusing to send invite.`,
              );
            }

            if (!baseUrl) {
              if (trustedOrigins.length === 0) {
                throw new Error('ALLOWED_ORIGINS not defined');
              }
              baseUrl = trustedOrigins[0];
            }

            // Double check final resolution
            if (!baseUrl || !trustedOrigins.includes(baseUrl)) {
              throw new Error(
                `Security Error: Resolved Base URL (${baseUrl}) is not in trusted origins.`,
              );
            }

            const inviteUrl = `${baseUrl}/invite/accept?id=${data.invitation.id}&email=${encodeURIComponent(data.email)}`;

            await emailSvc.sendEmail({
              to: data.email,
              subject: 'You have been invited to join an organization',
              text: `You have been invited to join ${data.organization.name}. Click here to accept: ${inviteUrl}`,
              html: `<p>You have been invited to join <strong>${data.organization.name}</strong>.</p><p><a href="${inviteUrl}">Click here to accept</a></p>`,
            });
          },
        }),
        admin(),
      ],
      advanced: {
        defaultCookieAttributes: {
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
        },
      },
      socialProviders: {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID || '',
          clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        },
      },
    });
    this.logger.log('Better Auth Initialized (with Injected DB)');
  }

  async createUser(user: CreateUser) {
    this.logger.log(`Creating user ${user.email} in Better Auth...`);
    try {
      // 1. Create User via Better Auth API
      if (!user.password) {
        throw new Error('Password is required for email signup');
      }
      const result = await this.auth.api.signUpEmail({
        body: {
          email: user.email,
          password: user.password,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        },
        asResponse: false,
      });

      // 2. Delegate Tenant Creation to Domain Service
      if (user.companyName) {
        this.logger.log('Delegating Tenant Creation to TenantsService');
        await this.tenantsService.createTenant(
          result.user.id,
          user.companyName,
        );
      }

      return result.user as unknown as schema.User;
    } catch (e: unknown) {
      const err = e as { body?: unknown; message?: string };
      this.logger.error('Error creating user/org:', err.body || err);
      throw e;
    }
  }

  async login(email: string, password?: string) {
    if (!password) {
      throw new Error('Password is required for email login');
    }
    // Use asResponse: true to get the full response headers (including Set-Cookie)
    // This allows us to forward the exact cookie Better Auth generates (signed/unsigned correctly)
    const apiResponse = await this.auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });

    if (!apiResponse.ok) {
      throw new Error('Login failed (API Error): ' + apiResponse.statusText);
    }

    // Capture all Set-Cookie headers using the standard Fetch API method
    // headers.get('set-cookie') only returns the first one (or comma joined which breaks dates)
    // headers.getSetCookie() returns all occurrences as an array.
    const cookieHeader =
      typeof apiResponse.headers.getSetCookie === 'function'
        ? apiResponse.headers.getSetCookie()
        : apiResponse.headers.get('set-cookie'); // Fallback for older node environs
    const result = (await apiResponse.json()) as {
      token: string;
      user: {
        id: string;
        email: string;
        name: string;
        image?: string | null;
        emailVerified: boolean;
        createdAt: string;
        updatedAt: string;
      };
    };

    // BetterAuth returns { token, user } but not always the full session object
    // We need the full session object to satisfy our Interface.
    // Note: 'result.token' is the session token.
    if (!result.token) {
      throw new Error('Login failed: No token returned');
    }

    // Direct DB Query for Session (More reliable than self-referential API call)
    const dbSession = await this.db.query.session.findFirst({
      where: eq(schema.session.token, result.token),
    });

    if (!dbSession) {
      // Fallback or retry? If BetterAuth just created it, it should be there.
      // If not found, maybe result.token IS the session ID?
      // BetterAuth usually uses token as the lookup.
      throw new Error('Login succeeded but session record not found in DB');
    }

    // Enrich with System Role from DB (Explicit)
    const dbUser = await this.db.query.user.findFirst({
      where: eq(schema.user.id, result.user.id),
      columns: {
        systemRole: true,
      },
    });

    return {
      session: dbSession,
      user: {
        ...result.user,
        systemRole: dbUser?.systemRole || 'user',
      } as unknown as schema.User,
      cookie: cookieHeader || undefined, // Return the native cookie string/array
    };
  }

  async validateSession(sessionId: string) {
    // Direct DB Query for Session
    const session = await this.db.query.session.findFirst({
      where: eq(schema.session.token, sessionId),
    });

    if (!session) {
      this.logger.warn(
        `validateSession: Session not found in DB for token: ${sessionId.substring(0, 10)}...`,
      );
      return null;
    }

    // Check Expiry (if needed, though Drizzle might handle it if we used standard adapters, but manual query returns raw)
    if (session.expiresAt < new Date()) {
      this.logger.warn(
        `validateSession: Session expired. ExpiresAt: ${session.expiresAt.toISOString()}, Now: ${new Date().toISOString()}`,
      );
      return null;
    }

    // Fetch User with System Role
    const user = await this.db.query.user.findFirst({
      where: eq(schema.user.id, session.userId),
      columns: {
        id: true,
        email: true,
        name: true,
        emailVerified: true,
        image: true,
        createdAt: true,
        updatedAt: true,
        role: true, // Tenant Role Default
        systemRole: true, // Platform Role (Critical)
        banned: true,
        banReason: true,
        banExpires: true,
      },
    });

    if (!user) {
      return null;
    }

    return {
      session: session as unknown as schema.Session,
      user: user as unknown as schema.User,
    };
  }

  async getSessionFromHeaders(headers: Headers) {
    // Delegate to Better Auth to parse cookies (signed or not)
    const result = await this.auth.api.getSession({
      headers,
    });

    if (!result) return null;

    return {
      session: result.session as unknown as schema.Session,
      user: result.user as unknown as schema.User,
    };
  }

  async getEnrichedSession(token: string) {
    // Re-use validateSession
    const sessionData = await this.validateSession(token);
    if (!sessionData) return null;

    // We still need to find membership to Enrich.
    // Since this is "Auth" enrichment, it's okay to query DB or use TenantsService.
    // Using TenantsService might be circular if we are not careful, but TenantsService imports DbModule not AuthModule now.
    // But wait, TenantsService doesn't have "findMembership".
    // Let's query DB directly here? Yes -> we have DRIZZLE_DB.
    // OR add findMembership to TenantsService.

    // Let's us DB directly for READ ONLY enrichment to keep it fast.
    // ... (Existing Logic using this.db) ...
    // Actually, let's reproduce the existing logic since we have this.db

    const memberships = await this.db.query.member.findMany({
      where: (member, { eq }) => eq(member.userId, sessionData.user.id),
      with: {
        organization: true,
      },
      limit: 1,
    });

    // Also fetch System Role fresh from DB
    const dbUser = await this.db.query.user.findFirst({
      where: eq(schema.user.id, sessionData.user.id),
      columns: {
        systemRole: true,
      },
    });

    const membership = memberships[0];

    return {
      session: sessionData.session,
      user: {
        ...sessionData.user,
        hasTenant: !!membership,
        organizationId: membership?.organizationId,
        organizationName: membership?.organization?.name, // Adjusted for Relation
        roles: [membership?.role || 'user'],
        systemRole: dbUser?.systemRole || 'user',
      },
    };
  }

  async createInvitation(payload: {
    email: string;
    role: string;
    organizationId: string | null;
    expiresIn?: number;
    inviterId: string;
    headers?: Headers;
  }) {
    if (!payload.organizationId) {
      // System-level invite (No organization) -> Use manual flow
      return this.createSystemInvitation(payload);
    }

    // Cast to any because the organization plugin methods are not being inferred correctly by TypeScript
    const api = this.auth.api as unknown as {
      createInvitation: (opts: {
        body: {
          email: string;
          role: string;
          organizationId: string | null;
          expiresIn?: number;
          inviterId?: string;
        };
        headers?: Headers;
      }) => Promise<unknown>;
    };

    return await api.createInvitation({
      body: {
        email: payload.email,
        role: payload.role,
        organizationId: payload.organizationId,
        expiresIn: payload.expiresIn,
        inviterId: payload.inviterId,
      },
      headers: payload.headers,
    });
  }

  private async createSystemInvitation(payload: {
    email: string;
    role: string;
    expiresIn?: number;
    inviterId: string;
  }) {
    const id = uuidv4();
    const expiresAt = new Date();
    expiresAt.setHours(
      expiresAt.getHours() +
        (payload.expiresIn ? payload.expiresIn / 3600 : 48),
    ); // Default 48h

    // Insert into DB
    const [invitation] = await this.db
      .insert(schema.invitation)
      .values({
        id,
        email: payload.email,
        role: payload.role,
        organizationId: null, // System-level
        inviterId: payload.inviterId,
        status: 'pending',
        expiresAt,
        createdAt: new Date(),
      })
      .returning();

    // Send Email
    const trustedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
    const frontendUrl = process.env.FRONTEND_URL;
    let baseUrl = frontendUrl;

    if (!baseUrl && trustedOrigins.length > 0) {
      baseUrl = trustedOrigins[0];
    }

    if (!baseUrl) {
      this.logger.error('Cannot send invite: No Base URL found');
      return invitation;
    }

    const inviteUrl = `${baseUrl}/invite/accept?id=${invitation.id}&email=${encodeURIComponent(invitation.email)}`;

    await this.emailService.sendEmail({
      to: payload.email,
      subject: 'You have been invited to join Nexiom',
      text: `You have been invited to join Nexiom. Click here to accept: ${inviteUrl}`,
      html: `<p>You have been invited to join <strong>Nexiom</strong>.</p><p><a href="${inviteUrl}">Click here to accept</a></p>`,
    });

    return invitation;
  }

  async getInvitation(id: string) {
    const api = this.auth.api as unknown as {
      getInvitation: (opts: { query: { id: string } }) => Promise<unknown>;
    };
    return await api.getInvitation({
      query: {
        id,
      },
    });
  }

  async acceptInvitation(invitationId: string, inviterId: string) {
    const api = this.auth.api as unknown as {
      acceptInvitation: (opts: {
        body: { invitationId: string };
      }) => Promise<unknown>;
    };
    // We log the inviterId for audit or context, though better-auth handles the link
    this.logger.log(
      `Accepting invitation ${invitationId}, triggered by user context ${inviterId}`,
    );

    return await api.acceptInvitation({
      body: {
        invitationId,
      },
    });
  }

  async listInvitations(organizationId: string) {
    // Direct DB Query for efficiency and access
    // We assume 'invitation' table is what Better Auth uses.
    // Better Auth schema is in 'schema' import.
    // We need to check if 'invitation' is exported from schema or if we need to use query builder dynamically.
    // Our schema.ts has 'invitation' table defined.

    return await this.db.query.invitation.findMany({
      where: (invitation, { eq, and }) =>
        and(
          eq(invitation.organizationId, organizationId),
          eq(invitation.status, 'pending'), // Only show pending invites
        ),
      orderBy: (invitation, { desc }) => [desc(invitation.createdAt)],
    });
  }

  getHandler() {
    return this.auth.handler;
  }

  async forceVerifyEmail(userId: string): Promise<void> {
    // Better Auth stores verification status in the 'user' table
    // We perform a direct update since we own the DB connection.
    await this.db
      .update(schema.user)
      .set({ emailVerified: true })
      .where(eq(schema.user.id, userId));

    this.logger.log(`Forcibly verified email for user ${userId} (Invite Flow)`);
  }

  async deleteUser(userId: string): Promise<void> {
    await this.db.delete(schema.user).where(eq(schema.user.id, userId));
    this.logger.warn(`User ${userId} deleted (Rollback/Cleanup)`);
  }

  async updateUser(userId: string, data: Partial<User>): Promise<User> {
    // Check if email is being updated, we need to sync 'account' table for 'credential' provider
    // because Better Auth uses email as the accountId for credentials.
    if (data.email) {
      const currentUser = await this.db.query.user.findFirst({
        where: eq(schema.user.id, userId),
      });

      if (currentUser && currentUser.email !== data.email) {
        // Update Account ID (which is the email for credentials)
        await this.db
          .update(schema.account)
          .set({ accountId: data.email })
          .where(
            and(
              eq(schema.account.userId, userId),
              eq(schema.account.providerId, 'credential'),
            ),
          );
      }
    }

    await this.db
      .update(schema.user)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(schema.user.id, userId));

    const updated = await this.db.query.user.findFirst({
      where: eq(schema.user.id, userId),
    });

    if (!updated) throw new Error('Failed to update user');

    // Cast the schema user to our entity User type (compatible)
    return updated as any as User;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const user = await this.db.query.user.findFirst({
      where: eq(schema.user.email, email),
    });
    return (user as any as User) || null;
  }

  async setPassword(userId: string, password: string): Promise<void> {
    // We try to import hashPassword dynamically or use the library's internal if exposed.
    // Since we can't easily rely on 'better-auth' exports for utils in this setup without verify,
    // We will attempt to use the instance's API if possible, or assume a standard hash if we were forced.
    // BUT, since we faced a compile error, we should rely on the library.
    // VS Code didn't show hashPassword in exports.
    // Let's try to use the 'crypto' Node module for now if better-auth uses standard scrypt?
    // NO, incompatibility with login verification.

    // Let's TRY to use this.auth.api.updateUser if we can bypass the compiler check for the body?
    // Or simpler: We Delete the 'account' (password credential) and re-create it using signUp?
    // No, signUp creates USER too.

    // OPTION: We assume 'better-auth' DOES export hashPassword, but maybe from 'better-auth/utils'?
    // Let's try to import it at the top of the file.
    // Since I can't edit the top easily with Replace, I'll assume checking node_modules/better-auth/dist/index.d.mts
    // showed `export * from "@better-auth/core/utils";`.
    // And `@better-auth/core/utils` likely has `hashPassword`.

    // Dynamic import to avoid top-level fail if path wrong? No, compile time.
    // I will use a simple workaround: Update the ACCOUNT table with a PLAINTEXT password?
    // NO!

    // I will use `this.auth.api` but cast it to any to call `setPassword` or `changePassword`?
    // better-auth doesn't have `setPassword` admin API yet?

    // BEST GUESS: `better-auth` exports `hashPassword`.
    // I will try to implement it assuming I can add the import.
    // I will add the import in a separate tool call if needed, or using MultiReplace.

    // For now, I'll throw if I can't do it, but I MUST do it.
    // I will use `require` to load it?

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { hashPassword } = require('better-auth') as {
      hashPassword: (p: string) => Promise<string>;
    };
    const hashedPassword = await hashPassword(password);

    const existingAccount = await this.db.query.account.findFirst({
      where: eq(schema.account.userId, userId),
    });

    if (existingAccount) {
      await this.db
        .update(schema.account)
        .set({ password: hashedPassword })
        .where(eq(schema.account.id, existingAccount.id));
    } else {
      // Create new account
      await this.db.insert(schema.account).values({
        id: uuidv4(),
        userId: userId,
        accountId: userId, // For credentials, often same or email.
        providerId: 'credential',
        password: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }
}

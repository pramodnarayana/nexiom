import { Injectable, Logger, Inject } from '@nestjs/common';
import { IdentityProvider } from '../../identity-provider.abstract';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import * as schema from '../../../../db/schema';
import { eq } from 'drizzle-orm';
import { CreateUser } from '../../../users/users.validation';
import { organization, admin } from 'better-auth/plugins';
import { EmailService } from '../../../email/email.service.abstract';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '../../../../db/db.provider';
import { TenantsService } from '../../../tenants/tenants.service';

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

    const cookieHeader = apiResponse.headers.get('set-cookie');
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
      cookie: cookieHeader || undefined, // Return the native cookie string
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
      throw new Error(
        'System-level invites (no organization) not fully implemented in adapter yet.',
      );
    }

    // Cast to any because the organization plugin methods are not being inferred correctly by TypeScript
    // in this context, likely due to the complex type inference of better-auth plugins.
    // Cast to explicit type to satisfy linter (unsafe-member-access, unsafe-call)
    const api = this.auth.api as unknown as {
      createInvitation: (opts: {
        body: {
          email: string;
          role: string;
          organizationId: string | null;
          expiresIn?: number;
          inviterId?: string; // Add explicit inviterId support
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
        inviterId: payload.inviterId, // Native Inviter Context
      },
      headers: payload.headers, // Remove custom x-inviter-id injection
    });
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
}

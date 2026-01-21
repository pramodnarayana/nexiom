import { Injectable, Logger, Inject } from '@nestjs/common';
import { IdentityProvider } from '../../identity-provider.abstract';
import { Invitation } from '../../../invitations/invitation.interface';
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
import * as bcrypt from 'bcryptjs';

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
        password: {
          hash: async (password: string) => {
            return await bcrypt.hash(password, 10);
          },
          verify: async ({ password, hash }) => {
            return await bcrypt.compare(password, hash);
          },
        },
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
    if (process.env.NODE_ENV !== 'production') {
      this.logger.debug(
        `DEBUG: Auth Keys: ${JSON.stringify(Object.keys(this.auth))}`,
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (this.auth && (this.auth as any).api) {
        this.logger.debug(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
          `DEBUG: Auth API Keys: ${JSON.stringify(Object.keys((this.auth as any).api))}`,
        );
      } else {
        this.logger.debug('DEBUG: Auth API is missing!');
      }
    }
  }

  async createUser(user: CreateUser, headers?: Headers | Record<string, any>) {
    this.logger.log(`Creating user ${user.email} in Better Auth...`);
    // console.log('[DEBUG] createUser: Headers present:', headers ? Object.keys(headers) : 'undefined');
    try {
      // 1. Create User via Better Auth API
      if (!user.password) {
        throw new Error('Password is required for email signup');
      }

      const api = this.auth.api as unknown as {
        signUpEmail: (opts: {
          body: {
            email: string;
            password: string;
            name: string;
          };
          asResponse?: boolean;
          headers?: Headers | Record<string, any>;
        }) => Promise<{
          user: {
            id: string;
            email: string;
            name?: string | null;
            emailVerified: boolean;
            createdAt: Date;
            updatedAt: Date;
          };
        }>;
      };

      const result = await api.signUpEmail({
        body: {
          email: user.email,
          password: user.password,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        },
        asResponse: false,
        headers: headers,
      });
      // 1.5. Safety Sync: Ensure user exists in DB (Critical for E2E tests with Mocks or replication lag)
      const existingDbUser = await this.db.query.user.findFirst({
        where: eq(schema.user.id, result.user.id),
      });

      if (!existingDbUser) {
        this.logger.warn(
          `User ${result.user.id} returned by BetterAuth but not found in DB. Syncing...`,
        );
        await this.db
          .insert(schema.user)
          .values({
            id: result.user.id,
            email: result.user.email,
            name: result.user.name || '',
            emailVerified: result.user.emailVerified,
            createdAt: new Date(result.user.createdAt),
            updatedAt: new Date(result.user.updatedAt),
            systemRole: 'platform_user', // Default
          })
          .onConflictDoNothing();
      }

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
      session: {
        id: string;
        expiresAt: string;
        createdAt: string;
        updatedAt: string;
        userId: string;
        token: string;
      };
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
    let dbSession = await this.db.query.session.findFirst({
      where: eq(schema.session.token, result.token),
    });

    if (!dbSession) {
      // Critical: In production, relying on sync mask logic could hide replication lag or consistency bugs.
      // We only allow this "Self-Healing" in Test/Dev environments where mocks might desync.
      if (
        process.env.NODE_ENV !== 'test' &&
        process.env.NODE_ENV !== 'development'
      ) {
        this.logger.error(
          `Session Sync Error: Token ${result.token.substring(0, 10)}... valid in BetterAuth but missing in DB. UserId: ${result.user.id}. Refusing to synthetic sync in non-test env.`,
        );
        throw new Error(
          'Session consistency error: Valid token not found in database',
        );
      }

      this.logger.warn(
        `Session for token ${result.token.substring(0, 10)}... not found in DB. Syncing (Test/Dev Only)...`,
      );

      // Force Sync Session (Critical for E2E mocks)
      const sessionData = {
        id: result.session?.id || uuidv4(),
        token: result.token,
        userId: result.user.id,
        expiresAt: new Date(result.session?.expiresAt || Date.now() + 86400000),
        createdAt: new Date(),
        updatedAt: new Date(),
        userAgent: 'system-sync',
        ipAddress: '127.0.0.1',
      };

      await this.db.insert(schema.session).values(sessionData);
      dbSession = await this.db.query.session.findFirst({
        where: eq(schema.session.token, result.token),
      });
    }

    if (!dbSession) {
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
        systemRole: dbUser?.systemRole || 'platform_user',
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

  async getSessionFromHeaders(headers: Headers | Record<string, any>) {
    // Delegate to Better Auth to parse cookies (signed or not)
    // Convert Headers object to plain object if needed
    const headerObj =
      headers instanceof Headers
        ? Object.fromEntries(headers.entries())
        : headers;
    const result = await this.auth.api.getSession({
      headers: headerObj as Record<string, string>,
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
        systemRole: dbUser?.systemRole || 'platform_user',
      },
    };
  }

  async createInvitation(payload: {
    email: string;
    role: string;
    organizationId: string | null;
    expiresIn?: number;
    inviterId: string;

    headers?: Headers | Record<string, any>;
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
        headers?: Headers | Record<string, any>;
      }) => Promise<unknown>;
    };

    // Convert Headers object to plain object if needed
    const headerObj =
      payload.headers instanceof Headers
        ? Object.fromEntries(payload.headers.entries())
        : payload.headers;

    return await api.createInvitation({
      body: {
        email: payload.email,
        role: payload.role,
        organizationId: payload.organizationId,
        expiresIn: payload.expiresIn,
        inviterId: payload.inviterId,
      },
      headers: headerObj,
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

    if (!baseUrl || !trustedOrigins.includes(baseUrl)) {
      this.logger.error(
        `Critical: Cannot send invite. Resolved Base URL (${baseUrl}) is not in trusted origins.`,
      );
      throw new Error(
        `Configuration Error: Resolved Base URL (${baseUrl}) is not in trusted origins.`,
      );
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

  async getInvitation(id: string, _headers?: Headers | Record<string, any>) {
    // FIX: Using Manual DB Query to bypass Better Auth API "Not Authenticated" error.
    // The invite fetch logic needs to be public for the signup flow validation.
    // We strictly filter for valid (pending and not expired) invitations.
    const invitation = await this.db.query.invitation.findFirst({
      where: (inv, { eq, and, gt }) =>
        and(
          eq(inv.id, id),
          eq(inv.status, 'pending'), // Strictly enforce pending status
          gt(inv.expiresAt, new Date()), // Not expired
        ),
    });

    return (invitation as unknown as Invitation) || null;
  }

  async acceptInvitation(
    invitationId: string,
    userId: string,
    _headers?: Headers | Record<string, any>,
  ) {
    // FIX: Using Manual DB Transaction to bypass Better Auth API "Not Authenticated" error.
    // Since this is called during Signup (Unauthenticated), we act as System.

    this.logger.log(
      `Accepting invitation ${invitationId} (Direct DB), triggered by user context ${userId}`,
    );

    return await this.db.transaction(async (tx) => {
      // 1. Fetch Invitation
      const invitation = await tx.query.invitation.findFirst({
        where: eq(schema.invitation.id, invitationId),
      });

      if (!invitation) {
        throw new Error('Invitation not found');
      }

      if (invitation.status !== 'pending') {
        throw new Error('Invitation is not pending');
      }

      if (invitation.expiresAt < new Date()) {
        throw new Error('Invitation expired');
      }

      // 2. Fetch User & Verify Identity
      const user = await tx.query.user.findFirst({
        where: eq(schema.user.id, userId),
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Strict Email Check: Ensure the user accepting matches the invite email
      if (
        user.email.toLowerCase().trim() !==
        invitation.email.toLowerCase().trim()
      ) {
        this.logger.warn(
          `Security Warning: User ${user.email} attempted to accept invite for ${invitation.email}`,
        );
        throw new Error(
          'Authorization Failed: You can only accept invitations sent to your email address.',
        );
      }

      // 3. Create Membership OR Update System Role
      if (invitation.organizationId) {
        await tx.insert(schema.member).values({
          id: uuidv4(),
          organizationId: invitation.organizationId,
          userId: userId, // The user accepting the invite
          role: invitation.role || 'user',
          createdAt: new Date(),
        });
      } else {
        // System-level invitation (No Organization)
        // We must promote the user to the role specified in the invite (e.g. platform_admin)
        if (invitation.role) {
          const allowedSystemRoles = new Set([
            'platform_user',
            'platform_admin',
          ]);
          if (!allowedSystemRoles.has(invitation.role)) {
            throw new Error('Invalid system role in invitation');
          }
          await tx
            .update(schema.user)
            .set({ systemRole: invitation.role })
            .where(eq(schema.user.id, userId));
        }
      }

      // 4. Update Invitation Status
      await tx
        .update(schema.invitation)
        .set({
          status: 'accepted',
        })
        .where(eq(schema.invitation.id, invitationId));

      return { success: true };
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
    await this.db.transaction(async (tx) => {
      // 1. Fetch User to get Email (for invitation cleanup)
      const user = await tx.query.user.findFirst({
        where: eq(schema.user.id, userId),
        columns: { email: true },
      });

      if (user) {
        // 2. Delete/Cancel Pending Invitations sent TO this user
        // This prevents stale invites if the user is re-created later.
        await tx
          .delete(schema.invitation)
          .where(
            and(
              eq(schema.invitation.email, user.email),
              eq(schema.invitation.status, 'pending'),
            ),
          );
      }

      // 3. Delete User Resources
      await tx.delete(schema.session).where(eq(schema.session.userId, userId));
      await tx.delete(schema.account).where(eq(schema.account.userId, userId));
      await tx.delete(schema.member).where(eq(schema.member.userId, userId));

      // Note: We do NOT delete invitations sent BY this user (inviterId) here automatically
      // because that might break history. But for rollback of a NEW user, they shouldn't have sent any.
      await tx.delete(schema.user).where(eq(schema.user.id, userId));
    });
    this.logger.warn(
      `User ${userId} deleted (Rollback/Cleanup) - Invitations cleaned.`,
    );
  }

  async updateUser(userId: string, data: Partial<User>): Promise<User> {
    return await this.db.transaction(async (tx) => {
      // Check if email is being updated, we need to sync 'account' table for 'credential' provider
      if (data.email) {
        const currentUser = await tx.query.user.findFirst({
          where: eq(schema.user.id, userId),
        });

        if (currentUser && currentUser.email !== data.email) {
          // Update Account ID (which is the email for credentials)
          await tx
            .update(schema.account)
            .set({ accountId: data.email, updatedAt: new Date() })
            .where(
              and(
                eq(schema.account.userId, userId),
                eq(schema.account.providerId, 'credential'),
              ),
            );
        }
      }

      await tx
        .update(schema.user)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(schema.user.id, userId));

      const updated = await tx.query.user.findFirst({
        where: eq(schema.user.id, userId),
      });

      if (!updated) throw new Error('Failed to update user');

      return updated as any as User;
    });
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const user = await this.db.query.user.findFirst({
      where: eq(schema.user.email, email),
    });
    return (user as any as User) || null;
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const hashedPassword = await bcrypt.hash(password, 10);

    const existingAccount = await this.db.query.account.findFirst({
      where: and(
        eq(schema.account.userId, userId),
        eq(schema.account.providerId, 'credential'),
      ),
    });

    if (existingAccount) {
      await this.db
        .update(schema.account)
        .set({ password: hashedPassword, updatedAt: new Date() })
        .where(eq(schema.account.id, existingAccount.id));
    } else {
      // Fetch user to get current email for accountId
      const user = await this.db.query.user.findFirst({
        where: eq(schema.user.id, userId),
      });

      if (!user) {
        throw new Error('User not found when creating credential account');
      }

      // Create new account
      await this.db.insert(schema.account).values({
        id: uuidv4(),
        userId: userId,
        accountId: user.email, // Use email as accountId for credentials
        providerId: 'credential',
        password: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }
}

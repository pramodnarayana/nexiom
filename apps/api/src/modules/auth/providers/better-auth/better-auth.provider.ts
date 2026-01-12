import { Injectable, Logger, Inject } from '@nestjs/common';
import { IdentityProvider } from '../../identity-provider.abstract';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import * as schema from '../../../../db/schema';
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
            // We need to construct the URL manually or use a frontend URL env var.
            // Assuming localhost:3000 or whatever frontend is.
            // Ideally we use process.env.NEXT_PUBLIC_APP_URL or similar.
            // For now, let's derive it from BETTER_AUTH_URL or just use a placeholder we can config.

            // NOTE: better-auth might not generate a full acceptance URL here, just the token logic.
            // We usually direct them to our Frontend page: /accept-invite?id=...
            const inviteUrl = `${process.env.BETTER_AUTH_URL}/invitations/accept?id=${data.invitation.id}`;

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
    const result = await this.auth.api.signInEmail({
      body: { email, password },
      asResponse: false,
    });
    return result as unknown as { session: schema.Session; user: schema.User };
  }

  async validateSession(sessionId: string) {
    const session = await this.auth.api.getSession({
      headers: new Headers({
        Authorization: `Bearer ${sessionId}`,
        Cookie: `better-auth.session_token=${sessionId}`,
      }),
      asResponse: false,
    });
    return session as unknown as {
      session: schema.Session;
      user: schema.User;
    } | null;
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

    const membership = memberships[0];

    return {
      session: sessionData.session,
      user: {
        ...sessionData.user,
        hasTenant: !!membership,
        organizationId: membership?.organizationId,
        organizationName: membership?.organization?.name, // Adjusted for Relation
        roles: [membership?.role || 'user'],
      },
    };
  }

  async createInvitation(payload: {
    email: string;
    role: string;
    organizationId: string | null;
    expiresIn?: number;
    inviterId: string;
  }) {
    if (!payload.organizationId) {
      // System Invite handling (Custom logic or specific Better Auth flow if supported)
      // For now, we will throw if Better Auth requires orgId, or assume our schema allows it.
      // Better Auth Organization plugin primarily works with Org ID.
      // If Organization ID is null, we might be creating a "User" invite without org.
      // Let's assume we can map this manually if needed, but for now try to pass it.
      // Inspecting Better Auth Types would be ideal.
      // For now, let's implement standard org invite.
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
      },
      headers: new Headers({
        // TODO: ideally pass inviter context if possible
        'x-inviter-id': payload.inviterId,
      }),
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

  getHandler() {
    return this.auth.handler;
  }

  // Removed listUsers and listTenants and updateTenantStatus
  // because "IdentityProvider" interface still has them defined?
  // We need to check the abstract class.
  // If abstract class requires them, we must implement or remove them from abstract.

  // Checking abstract class...
  // If we remove them from Abstract, we break Consumers who expect them on IdentityProvider.
  // The Consumers (TenantsService) used to call them.
  // But TenantsService IS the new owner. So TenantsService won't call IdentityProvider for this.
  // So we can remove them from IdentityProvider Abstract Class!

  // Implementation below assumes we update Abstract Class too.
}

import { Injectable, Logger } from '@nestjs/common';
import { IdentityProvider } from './identity-provider.abstract';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from '../schema/better-auth'; // Use Better Auth schema
import { CreateUser } from './users/users.schema';
import { organization } from "better-auth/plugins";
import { EmailService } from '../shared/email/email.service.abstract';

@Injectable()
export class BetterAuthIdentityProvider implements IdentityProvider {
    private auth: ReturnType<typeof betterAuth>;
    private db: any;
    private logger = new Logger(BetterAuthIdentityProvider.name);

    constructor(private readonly emailService: EmailService) {
        if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not defined');
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
        });
        this.db = drizzle(pool, { schema });

        if (!process.env.ALLOWED_ORIGINS) {
            throw new Error('ALLOWED_ORIGINS environment variable is not defined');
        }

        if (!process.env.BETTER_AUTH_URL) {
            throw new Error('BETTER_AUTH_URL environment variable is not defined');
        }

        this.auth = betterAuth({
            trustedOrigins: process.env.ALLOWED_ORIGINS.split(','),
            baseURL: process.env.BETTER_AUTH_URL,
            database: drizzleAdapter(this.db, {
                provider: "pg",
                schema: schema
            }),
            emailAndPassword: {
                enabled: true
            },
            customSession: async (session, user) => {
                // Check if user belongs to any organization
                const memberships = await this.db
                    .select({
                        role: schema.member.role,
                        organizationId: schema.organization.id,
                        organizationName: schema.organization.name
                    })
                    .from(schema.member)
                    .innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
                    .where(eq(schema.member.userId, user.id))
                    .limit(1);

                this.logger.log(`[CustomSession] User ${user.id} memberships found: ${memberships.length}`);
                if (memberships.length > 0) {
                    this.logger.log(`[CustomSession] Org: ${memberships[0].organizationName} (${memberships[0].organizationId})`);
                }

                const membership = memberships[0];

                return {
                    user: {
                        ...user,
                        hasTenant: !!membership,
                        organizationId: membership?.organizationId,
                        organizationName: membership?.organizationName
                    },
                    session
                }
            },
            emailVerification: {
                sendOnSignUp: true,
                autoSignInAfterVerification: true,
                sendVerificationEmail: async ({ user, url, token }) => {
                    await this.emailService.sendEmail({
                        to: user.email,
                        subject: 'Verify your email for Nexiom',
                        text: `Please verify your email by clicking the following link: ${url}`,
                        html: `<p>Please verify your email by clicking the following link: <a href="${url}">${url}</a></p>`
                    });
                }
            },
            plugins: [
                organization()
            ],
            socialProviders: {
                google: {
                    clientId: process.env.GOOGLE_CLIENT_ID || '',
                    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
                }
            }
        });
        this.logger.log('Better Auth Initialized');
        this.logger.log(`[Diagnostic] GOOGLE_CLIENT_ID present? ${!!process.env.GOOGLE_CLIENT_ID}`);
        this.logger.log(`[Diagnostic] BETTER_AUTH_URL: ${process.env.BETTER_AUTH_URL || 'default'}`);
    }

    async createUser(user: CreateUser) {
        this.logger.log(`Creating user ${user.email} in Better Auth...`);

        // 1. Create User via Internal API
        try {
            const result = await this.auth.api.signUpEmail({
                body: {
                    email: user.email,
                    password: user.password || 'temp1234',
                    name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
                },
                asResponse: false
            });

            // 2. Create Organization (Tenant) if companyName provided
            if ((user as any).companyName) {
                await this.createOrganizationForUser(result.user.id, (user as any).companyName);
            } else {
                // Auto-provision for Email usage too if needed, but usually email signup enforces it.
                // For now, we leave it optional here, but social login will force it.
            }

            return result.user;
        } catch (e: any) {
            this.logger.error('Error creating user/org:', e.body || e);
            throw e;
        }
    }

    /**
     * Helper to create an organization and add the user as admin.
     */
    private async createOrganizationForUser(userId: string, name: string) {
        this.logger.log(`Creating Organization ${name} for user ${userId}`);
        const orgId = crypto.randomUUID();
        const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + crypto.randomUUID().slice(0, 4);

        // Insert into organization table directly
        await this.db.insert(schema.organization).values({
            id: orgId,
            name: name,
            slug: slug,
            createdAt: new Date(),
        });

        // Insert into member table (Owner/Admin)
        await this.db.insert(schema.member).values({
            id: crypto.randomUUID(),
            organizationId: orgId,
            userId: userId,
            role: 'admin',
            createdAt: new Date(),
        });

        return { orgId, name, slug };
    }

    /**
     * Auto-provisions a tenant for an existing user (e.g. Social Login).
     */
    async provisionTenant(userId: string) {
        this.logger.log(`Provisioning Tenant for User ID: ${userId}`);

        // Double check if they already have one to avoid duplicates
        const existing = await this.db.select().from(schema.member).where(eq(schema.member.userId, userId)).limit(1);
        if (existing.length > 0) {
            this.logger.warn(`User ${userId} already has a tenant.`);
            return { message: 'User already has a tenant' };
        }

        const randomSuffix = crypto.randomUUID().slice(0, 8);
        const name = `Organization ${randomSuffix}`;
        try {
            const result = await this.createOrganizationForUser(userId, name);
            this.logger.log(`Provisioning Success: ${JSON.stringify(result)}`);
            return result;
        } catch (e) {
            this.logger.error(`Provisioning Failed for ${userId}`, e);
            throw e;
        }
    }

    async login(email: string, password?: string) {
        const result = await this.auth.api.signInEmail({
            body: { email, password: password! },
            asResponse: false
        });
        return result;
    }

    async validateSession(sessionId: string) {
        // Better Auth typically validates via Headers (Cookie or Bearer).
        // If we are using Bearer tokens:
        const session = await this.auth.api.getSession({
            headers: new Headers({
                'Authorization': `Bearer ${sessionId}`,
                'Cookie': `better-auth.session_token=${sessionId}` // FORCE: Make it look like a cookie too
            }),
            asResponse: false // Return data directly
        });
        return session;
    }

    /**
     * Manually retrieves the session and appends Organization data.
     * Implements IdentityProvider.getEnrichedSession.
     */
    async getEnrichedSession(token: string) {
        const sessionData = await this.validateSession(token);
        if (!sessionData) return null;

        // Manual Organization Lookup
        const memberships = await this.db
            .select({
                organizationId: schema.organization.id,
                organizationName: schema.organization.name,
                role: schema.member.role
            })
            .from(schema.member)
            .innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
            .where(eq(schema.member.userId, sessionData.user.id))
            .limit(1);

        const membership = memberships[0];

        this.logger.log(`[GetSessionWithOrg] Manual lookup for ${sessionData.user.id}. Found: ${memberships.length}`);

        return {
            session: sessionData.session,
            user: {
                ...sessionData.user,
                hasTenant: !!membership,
                organizationId: membership?.organizationId,
                organizationName: membership?.organizationName,
                role: membership?.role || 'user'
            }
        };
    }

    /**
     * Exposes the underlying Better Auth handler for use in NestJS controllers.
     * This is needed to support standard Better Auth routes like /sign-in/social.
     */
    getHandler() {
        return this.auth.handler;
    }

    async listUsers(tenantId?: string) {
        if (!tenantId) {
            // SAFE DEFAULT: Do not list all users unless explicitly handled/authorized for super-admin.
            // For now, return empty to prevent leaks.
            this.logger.warn('[listUsers] No tenantId provided. Returning empty list.');
            return [];
        }

        // Filter users who are members of the given organization (tenant)
        const usersInTenant = await this.db
            .select({
                id: schema.user.id,
                name: schema.user.name,
                email: schema.user.email,
                image: schema.user.image,
                createdAt: schema.user.createdAt,
                role: schema.member.role, // Include role from member table
            })
            .from(schema.user)
            .innerJoin(schema.member, eq(schema.member.userId, schema.user.id))
            .where(eq(schema.member.organizationId, tenantId));

        return usersInTenant;
    }
}

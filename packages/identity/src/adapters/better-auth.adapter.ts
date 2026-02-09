import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization, admin } from "better-auth/plugins";
import * as bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { eq, and } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { fromNodeHeaders } from "better-auth/node";

import type { ITenantProvider } from "../interfaces/tenant-provider.interface";
import type {
  IAuthProvider,
  LoginCredentials,
  CreateInvitationInput,
  AuthResult,
  Invitation,
  Session,
  User as UserInterface,
} from "../interfaces";
import type { CreateUserInput } from "../interfaces/user-provider.interface";
import {
  EMAIL_PROVIDER,
  IDENTITY_OPTIONS,
  IDENTITY_DB,
  BETTER_AUTH_CONFIG,
  TENANT_PROVIDER,
} from "../constants";
import type { IdentityModuleOptions } from "../identity.module";
import type { IEmailProvider } from "../interfaces/email-provider.interface";
import * as schema from "../schema";
import type { IncomingHttpHeaders } from "node:http";
import { Inject, Injectable } from "@nestjs/common";

export interface BetterAuthAdapterConfig {
  allowedOrigins: string[];
  betterAuthUrl: string;
  frontendUrl?: string; // For invite links
  googleClientId?: string;
  googleClientSecret?: string;
  nodeEnv?: string;
}

// Local Interface to type dynamic Better Auth API methods
interface BetterAuthApi {
  signUpEmail(params: {
    body: { email: string; password?: string; name?: string; image?: string };
    asResponse?: boolean;
  }): Promise<
    { user: UserInterface; session: Session; token: string } | Response
  >;

  signInEmail(params: {
    body: { email: string; password?: string };
    asResponse?: boolean;
  }): Promise<
    | {
        user: UserInterface;
        session: Session;
        token: string;
        twoFactorRedirect?: boolean;
      }
    | Response
  >;

  getSession(params: {
    headers: Headers;
  }): Promise<{ session: Session; user: UserInterface } | null>;

  createInvitation(params: {
    body: CreateInvitationInput;
    headers?: Headers;
  }): Promise<{ invitation: Invitation } | Invitation>;

  sendVerificationEmail(params: {
    body: { email: string };
    asResponse?: boolean;
  }): Promise<{ status: boolean; error?: { message: string } } | Response>;
}

@Injectable()
export class BetterAuthAdapter implements IAuthProvider {
  private readonly auth: ReturnType<typeof betterAuth>;

  constructor(
    @Inject(IDENTITY_DB) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(EMAIL_PROVIDER) private readonly emailService: IEmailProvider,
    @Inject(BETTER_AUTH_CONFIG)
    private readonly config: BetterAuthAdapterConfig,
    @Inject(TENANT_PROVIDER) private readonly tenantProvider: ITenantProvider, // Injected Dependency
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityModuleOptions,
  ) {
    if (!config.allowedOrigins || config.allowedOrigins.length === 0) {
      throw new Error("BetterAuthAdapter: allowedOrigins config is missing");
    }
    if (!config.betterAuthUrl) {
      throw new Error("BetterAuthAdapter: betterAuthUrl config is missing");
    }

    if (config.nodeEnv !== "production") {
      console.log(
        "Better Auth Adapter Initializing with Password Reset Enabled",
      );
    }

    // Enterprise Plugin for Tenant Auto-Provisioning
    const tenantProvisioningPlugin = {
      id: "tenant-provisioning",
      hooks: {
        after: [
          {
            matcher: (context: { path?: string }) => {
              const path = context.path;
              if (!path) return false;
              // Only trigger on Social Login Callback
              // Standard Email Signup is now handled via AuthService.registerUser
              return path.startsWith("/callback/");
            },
            // NOTE: ctx is typed as 'any' because better-auth does not export typed middleware context.
            // The middleware context structure is internal and may change between versions.
            // See: https://github.com/better-auth/better-auth/issues (tracking typed middleware support)
            handler: createAuthMiddleware(async (ctx: any) => {
              // Context returned contains the user info from the original action
              // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
              const returned = ctx.context.returned;

              // Helper to parse response if needed (Better Auth inner API returns typed objects usually)
              let user: UserInterface | undefined;

              if (returned && typeof returned === "object") {
                if ("user" in returned || "token" in returned) {
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                  user = returned.user as UserInterface;
                }
              }

              if (user?.id) {
                try {
                  // Idempotent Check: Handled by provisionTenantForUser logic
                  // We check existence to avoid redundant DB calls/logs
                  const existing = await this.tenantProvider.findAllForUser(
                    user.id,
                  );
                  if (existing.length === 0) {
                    try {
                      await this.tenantProvider.provisionTenantForUser(user.id);
                    } catch (err) {
                      console.error(
                        `[BetterAuth Hook] Failed to provision tenant for ${user.id}`,
                        err,
                      );
                    }
                  }
                } catch (error) {
                  // Suppress error to avoid failing the auth flow
                  console.error(`[BetterAuth Hook] verification failed`, error);
                }
              }

              // Void return, do not modify response
            }),
          },
        ],
      },
    };

    this.auth = betterAuth({
      trustedOrigins: config.allowedOrigins,
      // Use betterAuthUrl as baseURL (API URL)
      // We manually construct frontend redirects for email flows
      baseURL: config.betterAuthUrl,
      database: drizzleAdapter(this.db, {
        provider: "pg",
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
        sendResetPassword: async ({ user, url }) => {
          if (!url) {
            throw new Error("URL Argument is missing from Better Auth");
          }
          await this.emailService.sendEmail({
            to: user.email,
            subject: "Reset Password",
            text: `Reset your password here: ${url}`,
            html: `<a href="${url}">Reset Password</a>`,
          });
        },
      },
      emailVerification: {
        sendOnSignUp: true,
        autoSignInAfterVerification: true,
        sendVerificationEmail: async ({ user, url, token }) => {
          // Enterprise pattern: Explicitly construct the URL using URL object for robustness
          const frontendUrl = this.validateFrontendUrl(this.config.frontendUrl);

          // Use URL API to safely join paths and prevent double slashes
          const callbackTargetUrl = new URL(
            "/verify-email-callback",
            frontendUrl,
          );
          const callbackTarget = callbackTargetUrl.toString();

          // Use the URL object to safely manipulate parameters
          // We clear strict existing parameters to prevent any duplicates
          // NOTE: 'url' passed here might be frontendUrl based or betterAuthUrl based depending on config
          // But we want it to be CLEAN.

          if (!token) {
            throw new Error("Token Argument is missing from Better Auth");
          }

          if (!url) {
            throw new Error("URL Argument is missing from Better Auth");
          }
          const urlObj = new URL(url, this.config.betterAuthUrl);

          urlObj.search = ""; // Wipe existing query string (Removes default callbackURL=/)

          // Set our parameters
          urlObj.searchParams.set("token", token);
          urlObj.searchParams.set("callbackURL", callbackTarget);

          const verificationUrl = urlObj.toString();

          await this.emailService.sendEmail({
            to: user.email,
            subject: "Verify your email for Nexiom",
            text: `Please verify your email by clicking the following link: ${verificationUrl}`,
            html: `<p>Please verify your email by clicking the following link: <a href="${verificationUrl}">${verificationUrl}</a></p>`,
          });
        },
      },
      plugins: [
        organization({
          sendInvitationEmail: async (data) => {
            const frontendUrl = this.validateFrontendUrl(
              this.config.frontendUrl,
            );
            const inviteUrl = `${frontendUrl}/invite/accept?id=${data.invitation.id}&email=${encodeURIComponent(data.email)}`;

            await this.emailService.sendEmail({
              to: data.email,
              subject: "You have been invited to join an organization",
              text: `You have been invited to join ${data.organization.name}. Click here to accept: ${inviteUrl}`,
              html: `<p>You have been invited to join <strong>${data.organization.name}</strong>.</p><p><a href="${inviteUrl}">Click here to accept</a></p>`,
            });
          },
        }),
        admin(),
        tenantProvisioningPlugin, // Register our hook
      ],
      advanced: {
        defaultCookieAttributes: {
          secure: config.nodeEnv === "production",
          sameSite: "lax",
          path: "/",
        },
      },
      socialProviders: {
        ...(config.googleClientId && config.googleClientSecret
          ? {
              google: {
                clientId: config.googleClientId,
                clientSecret: config.googleClientSecret,
                enabled: true,
              },
            }
          : {}),
      },
    });
  }

  getHandler() {
    return this.auth.handler.bind(this.auth);
  }

  // Helper getter to access typed API
  private get api(): BetterAuthApi {
    return this.auth.api as unknown as BetterAuthApi;
  }

  private validateFrontendUrl(url?: string): string {
    if (url && this.config.allowedOrigins.includes(url)) {
      return url;
    }
    return this.config.allowedOrigins[0];
  }

  async createUser(input: CreateUserInput): Promise<UserInterface> {
    if (!input.password) {
      throw new Error("Password is required for email signup");
    }

    const result = (await this.api.signUpEmail({
      body: {
        email: input.email,
        password: input.password,
        name: `${input.firstName || ""} ${input.lastName || ""}`.trim(),
      },
      asResponse: false,
    })) as { user: UserInterface };

    if (!result || typeof result !== "object" || !result.user?.id) {
      throw new Error(
        `User creation failed: Unexpected response from Better Auth.`,
      );
    }

    // Role Assignment: If a role is provided, update the user record
    // Better Auth's signUpEmail might not map custom fields by default depending on config
    if (input.role) {
      await this.db
        .update(schema.user)
        .set({ role: input.role })
        .where(eq(schema.user.id, result.user.id));
    }

    // Rehydrate from DB to ensure consistent Date objects
    const dbUser = await this.db.query.user.findFirst({
      where: eq(schema.user.id, result.user.id),
    });

    if (!dbUser) {
      throw new Error("User created but not found in database");
    }

    return await this.mapUser(dbUser);
  }

  async login(credentials: LoginCredentials): Promise<AuthResult> {
    if (!credentials.password) {
      throw new Error("Password is required for email login");
    }

    // Using Better Auth API

    // Using Better Auth API
    const apiResponse = (await this.api.signInEmail({
      body: { email: credentials.email, password: credentials.password },
      asResponse: true,
    })) as Response;

    if (!apiResponse.ok) {
      const errorData = (await apiResponse.json()) as {
        error?: { message?: string };
      };
      throw new Error(
        `Login failed: ${errorData?.error?.message || apiResponse.statusText}`,
      );
    }

    const cookieHeader =
      typeof apiResponse.headers.getSetCookie === "function"
        ? apiResponse.headers.getSetCookie()
        : apiResponse.headers.get("set-cookie");

    const result = (await apiResponse.json()) as {
      token: string;
      user: { id: string };
      twoFactorRedirect?: boolean;
    };

    // Validate Response Shape

    if (result.twoFactorRedirect) {
      throw new Error("2FA required (not supported via this adapter yet)");
    }

    if (!result.token || typeof result.token !== "string") {
      throw new Error("Login failed (No token returned)");
    }

    if (!result.user?.id) {
      throw new Error("Login failed (No user returned)");
    }

    // Resolve Session from DB for consistency
    const dbSession = await this.db.query.session.findFirst({
      where: eq(schema.session.token, result.token),
    });

    if (!dbSession) throw new Error("Session not found after login");

    const dbUser = await this.db.query.user.findFirst({
      where: eq(schema.user.id, result.user.id),
    });

    if (!dbUser) throw new Error("User not found after login");

    return {
      session: this.mapSession(dbSession),
      user: await this.mapUser(dbUser),
      cookie: cookieHeader || undefined,
    };
  }

  async validateSession(
    token: string,
  ): Promise<{ session: Session; user: UserInterface } | null> {
    const session = await this.db.query.session.findFirst({
      where: eq(schema.session.token, token),
    });

    if (!session) return null;
    if (session.expiresAt < new Date()) return null;

    const user = await this.db.query.user.findFirst({
      where: eq(schema.user.id, session.userId),
    });

    if (!user) return null;

    return {
      session: this.mapSession(session),
      user: await this.mapUser(user),
    };
  }

  async getSessionFromHeaders(
    headers: Headers | Record<string, string | string[] | undefined>,
  ): Promise<{ session: Session; user: UserInterface } | null> {
    const headerObj =
      headers instanceof Headers
        ? headers
        : fromNodeHeaders(headers as IncomingHttpHeaders);

    const result = await this.api.getSession({
      headers: headerObj,
    });

    if (!result?.session?.token) {
      return null;
    }

    // Rehydrate and validate from DB to ensure consistent object shape (dates etc)
    const validSession = await this.validateSession(result.session.token);
    return validSession;
  }

  async createInvitation(input: CreateInvitationInput): Promise<Invitation> {
    if (!input.organizationId) {
      // System invite
      return this.createSystemInvitation(input);
    }

    try {
      const result = await this.api.createInvitation({
        body: {
          email: input.email,
          role: input.role,
          organizationId: input.organizationId,
          expiresIn: input.expiresIn,
          inviterId: input.inviterId,
        },
        headers: this.resolveHeaders(input.headers),
      });

      const invData = ("invitation" in result
        ? result.invitation
        : result) as unknown as Record<string, unknown>;

      return this.validateInvitationResponse(invData);
    } catch (error) {
      console.error("[BetterAuthAdapter] api.createInvitation failed:", error);
      throw error;
    }
  }

  private resolveHeaders(headers: CreateInvitationInput["headers"]) {
    if (!headers) return undefined;
    if (headers instanceof Headers) return headers;
    return fromNodeHeaders(headers as IncomingHttpHeaders);
  }

  private validateInvitationResponse(
    invData: Record<string, unknown>,
  ): Invitation {
    if (!invData || typeof invData !== "object") {
      throw new Error(
        "Invalid response from createInvitation: Missing invitation data",
      );
    }

    const requiredFields = [
      "id",
      "email",
      "role",
      "organizationId",
      "inviterId",
      "status",
      "expiresAt",
      "createdAt",
    ];

    for (const field of requiredFields) {
      const value = invData[field];

      if (field === "role") {
        if (value === undefined) {
          throw new Error(
            `Invalid response from createInvitation: Missing field "${field}"`,
          );
        }
      } else if (value === undefined || value === null || value === "") {
        throw new Error(
          `Invalid response from createInvitation: Missing field "${field}"`,
        );
      }
    }

    const expiresAt = new Date(invData.expiresAt as string);
    const createdAt = new Date(invData.createdAt as string);

    if (Number.isNaN(expiresAt.getTime())) {
      throw new TypeError(
        "Invalid response from createInvitation: Invalid expiresAt date",
      );
    }
    if (Number.isNaN(createdAt.getTime())) {
      throw new TypeError(
        "Invalid response from createInvitation: Invalid createdAt date",
      );
    }

    return {
      id: invData.id as string,
      email: invData.email as string,
      role: invData.role as string,
      organizationId: invData.organizationId as string,
      inviterId: invData.inviterId as string,
      status: invData.status as
        | "pending"
        | "accepted"
        | "rejected"
        | "canceled",
      expiresAt: expiresAt,
      createdAt: createdAt,
    };
  }

  private async createSystemInvitation(
    input: CreateInvitationInput,
  ): Promise<Invitation> {
    const id = uuidv4();
    const expiresAt = new Date();
    // Convert expiresIn (seconds) to hours - default 48h
    expiresAt.setHours(
      expiresAt.getHours() + (input.expiresIn ? input.expiresIn / 3600 : 48),
    );

    const [invitation] = await this.db
      .insert(schema.invitation)
      .values({
        id,
        email: input.email,
        role: input.role,
        organizationId: null,
        inviterId: input.inviterId,
        status: "pending",
        expiresAt,
        createdAt: new Date(),
      })
      .returning();

    // Send Email
    const frontendUrl = this.validateFrontendUrl(this.config.frontendUrl);
    const inviteUrl = `${frontendUrl}/invite/accept?id=${invitation.id}&email=${encodeURIComponent(invitation.email)}`;
    await this.emailService.sendEmail({
      to: input.email,
      subject: "You have been invited to join Nexiom",
      text: `You have been invited to join Nexiom. Click here to accept: ${inviteUrl}`,
      html: `<p>You have been invited to join <strong>Nexiom</strong>.</p><p><a href="${inviteUrl}">Click here to accept</a></p>`,
    });

    return this.mapInvitation(invitation);
  }

  async getInvitation(id: string): Promise<Invitation | null> {
    const inv = await this.db.query.invitation.findFirst({
      where: (t, { eq, and, gt }) =>
        and(eq(t.id, id), eq(t.status, "pending"), gt(t.expiresAt, new Date())),
    });
    return inv ? this.mapInvitation(inv) : null;
  }

  async acceptInvitation(invitationId: string, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const inv = await tx.query.invitation.findFirst({
        where: eq(schema.invitation.id, invitationId),
      });
      if (!inv) {
        throw new Error("Invalid or expired invitation");
      }
      if (inv.status !== "pending" || inv.expiresAt < new Date()) {
        throw new Error("Invalid or expired invitation");
      }

      const user = await tx.query.user.findFirst({
        where: eq(schema.user.id, userId),
      });
      if (!user) throw new Error("User not found");

      if (user.email.toLowerCase().trim() !== inv.email.toLowerCase().trim()) {
        throw new Error("Email mismatch");
      }

      if (inv.organizationId) {
        await tx.insert(schema.member).values({
          id: uuidv4(),
          organizationId: inv.organizationId,
          userId: userId,
          role: inv.role === "user" ? "member" : inv.role || "member",
          createdAt: new Date(),
        });
      } else {
        // System role -> Membership in System Tenant
        // Check for existing membership first to avoid duplicates
        const existingMember = await tx.query.member.findFirst({
          where: and(
            eq(schema.member.userId, userId),
            eq(
              schema.member.organizationId,
              this.options.constants.systemTenantId,
            ),
          ),
        });

        if (!existingMember) {
          await tx.insert(schema.member).values({
            id: uuidv4(),
            organizationId: this.options.constants.systemTenantId,
            userId: userId,
            role: inv.role || "member",
            createdAt: new Date(),
          });
        }
      }

      await tx
        .update(schema.invitation)
        .set({ status: "accepted" })
        .where(eq(schema.invitation.id, invitationId));
    });
  }

  async listInvitations(organizationId: string): Promise<Invitation[]> {
    const invitations = await this.db.query.invitation.findMany({
      where: (t, { eq, and }) =>
        and(eq(t.organizationId, organizationId), eq(t.status, "pending")),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });

    return invitations.map((i) => this.mapInvitation(i));
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const hashedPassword = await bcrypt.hash(password, 10);
    // Logic for credential provider update... assuming 'credential' providerId

    // Upsert equivalent: Try to find, then update or insert
    const existingAccount = await this.db.query.account.findFirst({
      where: and(
        eq(schema.account.userId, userId),
        eq(schema.account.providerId, "credential"),
      ),
    });

    if (existingAccount) {
      await this.db
        .update(schema.account)
        .set({ password: hashedPassword, updatedAt: new Date() })
        .where(eq(schema.account.id, existingAccount.id));
    } else {
      await this.db.insert(schema.account).values({
        id: uuidv4(),
        userId: userId,
        accountId: userId, // For credentials, accountId is often the userId or email
        providerId: "credential",
        password: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  async findById(userId: string): Promise<UserInterface> {
    const dbUser = await this.db.query.user.findFirst({
      where: eq(schema.user.id, userId),
    });
    if (!dbUser) {
      console.warn(`[BetterAuthAdapter] findById: User ${userId} not found`);
      throw new Error("User not found");
    }
    return this.mapUser(dbUser);
  }

  // --- Mappers ---
  private async mapUser(dbUser: schema.User): Promise<UserInterface> {
    const role = dbUser.role || "user";
    const permissions: Set<string> = new Set();
    const roleIds: string[] = [];

    // 1. Add Global Role ID
    // Note: If dbUser.role is a name (legacy) vs ID, this might need resolution.
    // Assuming dbUser.role is an ID or we treat it as one for lookup.
    // In strict schema, user.role is text, could be 'admin' or UUID.
    // We'll attempt to add it.
    if (dbUser.role) roleIds.push(dbUser.role);

    try {
      // 2. Add Tenant Role IDs
      const members = await this.db.query.member.findMany({
        where: eq(schema.member.userId, dbUser.id),
        columns: { role: true },
      });

      for (const m of members) {
        if (m.role) roleIds.push(m.role);
      }

      // 3. Fetch Permissions for all gathered Role IDs
      if (roleIds.length > 0) {
        // Dedupe roleIds
        const uniqueRoleIds = [...new Set(roleIds)];

        // We use inArray. Need to import it or use query builder.
        // Using db.select().from(rolePermission).where(inArray(...))
        // Since we are inside a class, we need to ensure 'inArray' is available.
        // It is not imported in the file snippet I saw. I'll rely on db.query.
        // db.query.rolePermission.findMany({ where: (rp, { inArray }) => inArray(rp.roleId, uniqueRoleIds) })

        const rolePerms = await this.db.query.rolePermission.findMany({
          where: (rp, { inArray }) => inArray(rp.roleId, uniqueRoleIds),
          columns: { permissionId: true },
        });

        for (const rp of rolePerms) {
          permissions.add(rp.permissionId);
        }
      }

      // 4. Legacy/Fallback Hardcoded Logic (Safety net for non-seeded roles)
      // If no permissions found via DB, check for legacy string matches
      if (permissions.size === 0) {
        if (role === "admin") {
          permissions.add("*:*");
        } else {
          // Basic
          permissions.add("dashboard:view");
        }
      } else {
        // Always ensure basic dashboard access if they have any permissions?
        // RBAC seeding should handle this, but for safety:
        permissions.add("dashboard:view");
      }
    } catch (err) {
      console.error(
        `[BetterAuthAdapter] mapUser: Failed to fetch permissions for ${dbUser.id}`,
        err,
      );
      // Fallback
      permissions.add("dashboard:view");
    }

    const finalPermissions = Array.from(permissions);

    return {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name || undefined,
      emailVerified: dbUser.emailVerified,
      image: dbUser.image || undefined,
      createdAt: dbUser.createdAt,
      updatedAt: dbUser.updatedAt,
      role: role,
      permissions: finalPermissions,
      banned: dbUser.banned || false,
      banReason: dbUser.banReason || null,
      banExpires: dbUser.banExpires || null,
    };
  }

  private mapSession(dbSession: schema.Session): Session {
    return {
      id: dbSession.id,
      token: dbSession.token,
      userId: dbSession.userId,
      expiresAt: dbSession.expiresAt,
      createdAt: dbSession.createdAt,
      updatedAt: dbSession.updatedAt,
      ipAddress: dbSession.ipAddress || undefined,
      userAgent: dbSession.userAgent || undefined,
    };
  }

  private mapInvitation(dbInv: schema.Invitation): Invitation {
    const rawStatus = dbInv.status;
    let status: "pending" | "accepted" | "rejected" | "canceled" = "pending";

    if (
      rawStatus === "pending" ||
      rawStatus === "accepted" ||
      rawStatus === "rejected" ||
      rawStatus === "canceled"
    ) {
      status = rawStatus;
    } else {
      // Log warning for unexpected status
      console.warn(
        `[BetterAuthAdapter] mapInvitation: Unexpected status "${rawStatus}" for invitation ${dbInv.id}. Fallback to "pending".`,
      );
      // Fallback is implicit via initialization, but explicit logging helps observability.
    }

    return {
      id: dbInv.id,
      email: dbInv.email,
      role: dbInv.role || "user",
      organizationId: dbInv.organizationId,
      inviterId: dbInv.inviterId,
      status: status,
      expiresAt: dbInv.expiresAt,
      createdAt: dbInv.createdAt,
    };
  }

  /**
   * Resend verification email for a user
   * @param email User's email address
   */
  async resendVerificationEmail(email: string): Promise<void> {
    // Find user by email
    const user = await this.db.query.user.findFirst({
      where: eq(schema.user.email, email),
    });

    if (!user) {
      // Mask email for logging: a***@example.com
      let masked: string;
      if (email.includes("@")) {
        masked = email.replace(/(^.)[^@]*(@.*$)/, "$1***$2");
      } else if (email.length > 0) {
        // If no @, mask all but first char: a***
        masked = email.substring(0, 1) + "***";
      } else {
        masked = "***";
      }
      console.warn(
        `[BetterAuthAdapter] resendVerificationEmail: User not found for email ${masked}`,
      );
      return;
    }

    if (user.emailVerified) {
      console.warn(
        `[BetterAuthAdapter] resendVerificationEmail: Email already verified for user ${user.id}`,
      );
      return;
    }

    // Generate verification token using Better Auth's API
    // Better Auth will use the configured baseURL/trustedOrigins to construct the verification URL

    const res = await this.api.sendVerificationEmail({
      body: {
        email: user.email,
      },
      asResponse: true,
    });

    // Check if result is the object form (status: boolean)
    if (
      res &&
      typeof res === "object" &&
      "status" in res &&
      typeof (res as Record<string, unknown>).status === "boolean"
    ) {
      const typedRes = res as { status: boolean; error?: { message: string } };
      if (!typedRes.status) {
        throw new Error(
          `Failed to send verification email: ${typedRes.error?.message || "Unknown error"}`,
        );
      }
      return; // Success case for object return
    }

    // Otherwise treat as Response object
    const response = res as Response;

    if (!response.ok) {
      const errorData = (await response.json()) as {
        error?: { message?: string };
      };

      throw new Error(
        `Failed to send verification email: ${errorData?.error?.message || response.statusText}`,
      );
    }
  }
}

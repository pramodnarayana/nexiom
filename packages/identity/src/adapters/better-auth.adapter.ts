import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import * as bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { eq, and } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { fromNodeHeaders } from "better-auth/node";
import { normalizeRole } from "../utils/role-normalization";
import { getBetterAuthPlugins } from "../better-auth.config";
import { validateFrontendUrl } from "../utils/url.util";

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
import type { BetterAuthAdapterConfig } from "../interfaces/better-auth-config.interface";
import * as schema from "../schema";
import type { IncomingHttpHeaders } from "node:http";
import { Inject, Injectable } from "@nestjs/common";

export const PERMISSION_FALLBACK_DASHBOARD_READ = "dashboard:read";

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

  /** Shared Drizzle `with` clause for eager-loading member roles + permissions. */
  private static readonly USER_WITH_MEMBERS = {
    members: {
      with: {
        role: {
          with: { permissions: true },
        },
      },
    },
  } as const;

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
        sendOnSignUp: false, // Orchestrated by config hooks
        autoSignInAfterVerification: true,
        sendVerificationEmail: async ({ user, url, token }) => {
          // Enterprise pattern: Explicitly construct the URL using URL object for robustness
          const frontendUrl = validateFrontendUrl(
            this.config.frontendUrl,
            this.config.allowedOrigins,
          );

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
      plugins: getBetterAuthPlugins(
        this.emailService,
        config,
        this.tenantProvider,
      ),
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

    // Role Assignment: Ignored to enforce strict single-tenant architecture.
    // The 'user.role' field is legacy and should not be written to.
    // Membership creation must be handled by the caller or invitation flow.

    // Rehydrate from DB to ensure consistent Date objects + eager-load members
    const dbUser = await this.db.query.user.findFirst({
      where: eq(schema.user.id, result.user.id),
      with: BetterAuthAdapter.USER_WITH_MEMBERS,
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
      with: BetterAuthAdapter.USER_WITH_MEMBERS,
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
      with: BetterAuthAdapter.USER_WITH_MEMBERS,
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
      // Redact PII: Log only safe structural fields
      const errorDetails =
        typeof error === "object" && error !== null
          ? {
              name: (error as Error).name,
              message: (error as Error).message,
              status:
                (error as { status?: number; statusCode?: number }).status ||
                (error as { status?: number; statusCode?: number }).statusCode,
              code: (error as { code?: string }).code,
            }
          : String(error);

      console.error(
        "[BetterAuthAdapter] api.createInvitation failed:",
        errorDetails,
      );
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
          role: inv.role || "member",
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
      with: BetterAuthAdapter.USER_WITH_MEMBERS,
    });
    if (!dbUser) {
      throw new Error("User not found");
    }
    return this.mapUser(dbUser);
  }

  // --- Mappers ---
  private async mapUser(
    dbUser: schema.User & {
      members?: (Omit<schema.Member, "role"> & {
        role?:
          | string
          | (schema.Role & {
              permissions?: schema.RolePermission[];
            });
      })[];
    },
  ): Promise<UserInterface> {
    // STRICT SINGLE-TENANT ARCHITECTURE
    // We ignore `dbUser.role` (legacy global field) entirely.
    // Permissions and Role are derived EXCLUSIVELY from the `member` record.

    let role = "member";
    const permissions: Set<string> = new Set();

    // 1. Unify Member Resolution (Eager vs Lazy)
    let members = dbUser.members;

    // Fallback: Lazy fetch if members weren't included in the initial query.
    // We define the type to match the expected structure of dbUser.members
    // The error "Type 'null' is not assignable" suggests that schema.Role allows nulls that weren't accounted for
    type MemberWithRole = Omit<schema.Member, "role"> & {
      role:
        | string
        | null
        | (schema.Role & {
            permissions?: schema.RolePermission[];
          });
    };

    let fetchedMembers: MemberWithRole[] | undefined;

    if (!members) {
      fetchedMembers = await this.db.query.member.findMany({
        where: eq(schema.member.userId, dbUser.id),
        with: {
          role: {
            with: { permissions: true },
          },
        },
      });
      // We know fetchedMembers matches the shape, but to satisfy the exact inferred type of dbUser.members
      // (which comes from Drizzle's query builder inference), we use an intermediate cast to unknown
      // to bypass the "no overlap" error (since typeof members includes undefined).
      members = fetchedMembers as unknown as typeof members;
    }

    const hasMembership = members && members.length > 0;

    if (hasMembership) {
      // Enforce Single-Membership Invariant
      if (members!.length > 1) {
        console.error(
          `[BetterAuthAdapter] User ${dbUser.id} has ${members!.length} memberships; expected at most 1.`,
        );
        throw new Error(
          "BetterAuthAdapter: Multiple memberships detected for user in strict single-tenant application.",
        );
      }

      const m = members![0];
      const normalized = normalizeRole(m.role);

      if (normalized.name !== "unknown") {
        role = normalized.name;
      }

      if (normalized.permissions && normalized.permissions.length > 0) {
        for (const rp of normalized.permissions) {
          // Enterprise ABAC: Return full rule object (Action, Subject, Conditions)
          // Format expected by Frontend Ability: { action, subject, conditions }
          // We serialize this to a string or keep it as object if interface allows.
          // Currently UserInterface.permissions is likely string[].
          // We will use a convention: "resource:action" OR JSON string for complex rules.

          if (rp.permission) {
            if (rp.conditions) {
              const rule = {
                action: rp.permission.action,
                subject: rp.permission.resource,
                conditions: rp.conditions,
              };
              permissions.add(JSON.stringify(rule));
            } else {
              // Backward compatibility / Simple PBAC
              permissions.add(
                `${rp.permission.resource}:${rp.permission.action}`,
              );
            }
          }
        }
      }
    }

    // 2. Supplementary permission query
    //    We check for string role IDs and fetch their permissions if needed.
    //    We do this regardless of preloaded permissions to ensure we don't drop legacy role data.
    if (hasMembership) {
      const roleIds = members!
        .map((m) => {
          const normalized = normalizeRole(m.role);
          return normalized.id !== "unknown" ? normalized.id : undefined;
        })
        .filter((id): id is string => !!id);

      if (roleIds.length > 0) {
        const uniqueRoleIds = [...new Set(roleIds)];
        const rolePerms = await this.db.query.rolePermission.findMany({
          where: (rp, { inArray }) => inArray(rp.roleId, uniqueRoleIds),
          columns: { permissionId: true },
        });
        for (const rp of rolePerms) {
          permissions.add(rp.permissionId);
        }
      }
    }

    // 3. Fallback / Default Permissions
    if (permissions.size === 0) {
      console.warn(
        `[BetterAuthAdapter] No permissions resolved for user ${dbUser.id}; applying fallback: ${PERMISSION_FALLBACK_DASHBOARD_READ}`,
      );
      permissions.add(PERMISSION_FALLBACK_DASHBOARD_READ);
    }

    return {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name ?? null,
      emailVerified: dbUser.emailVerified,
      image: dbUser.image || undefined,
      createdAt: dbUser.createdAt,
      updatedAt: dbUser.updatedAt,
      role: role.toLowerCase(),
      permissions: Array.from(permissions),
      banned: dbUser.banned || false,
      banReason: dbUser.banReason || null,
      banExpires: dbUser.banExpires || null,
      hasTenant: hasMembership,
      memberRole: role.toLowerCase(),
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
      role: dbInv.role || "member",
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

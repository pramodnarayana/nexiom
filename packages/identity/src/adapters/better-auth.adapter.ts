/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization, admin } from "better-auth/plugins";
import * as bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { eq, and } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { fromNodeHeaders } from "better-auth/node";

import {
  IAuthProvider,
  LoginCredentials,
  CreateInvitationInput,
  AuthResult,
  Invitation,
  Session,
  User as UserInterface,
} from "../interfaces";
import { CreateUserInput } from "../interfaces/user-provider.interface";
import { IEmailProvider } from "../interfaces/email-provider.interface";
import * as schema from "../schema";
import { IncomingHttpHeaders } from "node:http";

export interface BetterAuthAdapterConfig {
  allowedOrigins: string[];
  betterAuthUrl: string;
  frontendUrl?: string; // For invite links
  googleClientId?: string;
  googleClientSecret?: string;
  nodeEnv?: string;
}

export class BetterAuthAdapter implements IAuthProvider {
  private readonly auth: ReturnType<typeof betterAuth>;

  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly emailService: IEmailProvider,
    private readonly config: BetterAuthAdapterConfig,
  ) {
    if (!config.allowedOrigins || config.allowedOrigins.length === 0) {
      throw new Error("BetterAuthAdapter: allowedOrigins config is missing");
    }
    if (!config.betterAuthUrl) {
      throw new Error("BetterAuthAdapter: betterAuthUrl config is missing");
    }

    this.auth = betterAuth({
      trustedOrigins: config.allowedOrigins,
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
      },
      user: {
        additionalFields: {
          systemRole: {
            type: "string",
            required: false,
          },
        },
      },
      emailVerification: {
        sendOnSignUp: true,
        autoSignInAfterVerification: true,
        sendVerificationEmail: async ({ user, url }) => {
          await this.emailService.sendEmail({
            to: user.email,
            subject: "Verify your email for Nexiom",
            text: `Please verify your email by clicking the following link: ${url}`,
            html: `<p>Please verify your email by clicking the following link: <a href="${url}">${url}</a></p>`,
          });
        },
      },
      plugins: [
        organization({
          sendInvitationEmail: async (data) => {
            const inviteUrl = `${this.config.frontendUrl || this.config.allowedOrigins[0]}/invite/accept?id=${data.invitation.id}&email=${encodeURIComponent(data.email)}`;

            await this.emailService.sendEmail({
              to: data.email,
              subject: "You have been invited to join an organization",
              text: `You have been invited to join ${data.organization.name}. Click here to accept: ${inviteUrl}`,
              html: `<p>You have been invited to join <strong>${data.organization.name}</strong>.</p><p><a href="${inviteUrl}">Click here to accept</a></p>`,
            });
          },
        }),
        admin(),
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

  async createUser(input: CreateUserInput): Promise<UserInterface> {
    if (!input.password) {
      throw new Error("Password is required for email signup");
    }

    const api = this.auth.api as any;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    const result = await api.signUpEmail({
      body: {
        email: input.email,
        password: input.password,
        name: `${input.firstName || ""} ${input.lastName || ""}`.trim(),
      },
      asResponse: false,
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
    return this.mapUser(result.user);
  }

  async login(credentials: LoginCredentials): Promise<AuthResult> {
    if (!credentials.password) {
      throw new Error("Password is required for email login");
    }

    // Using Better Auth API

    const api = this.auth.api as any;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    const apiResponse = await api.signInEmail({
      body: { email: credentials.email, password: credentials.password },
      asResponse: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (!apiResponse.ok) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      throw new Error("Login failed (API Error): " + apiResponse.statusText);
    }

    const cookieHeader =
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      typeof apiResponse.headers.getSetCookie === "function"
        ? // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
          apiResponse.headers.getSetCookie()
        : // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
          apiResponse.headers.get("set-cookie");

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    const result = await apiResponse.json();

    // Resolve Session from DB for consistency
    const dbSession = await this.db.query.session.findFirst({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      where: eq(schema.session.token, result.token),
    });

    if (!dbSession) throw new Error("Session not found after login");

    const dbUser = await this.db.query.user.findFirst({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      where: eq(schema.user.id, result.user.id),
    });

    if (!dbUser) throw new Error("User not found after login");

    return {
      session: this.mapSession(dbSession),
      user: this.mapUser(dbUser),
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
      user: this.mapUser(user),
    };
  }

  async getSessionFromHeaders(
    headers: Headers | Record<string, string | string[] | undefined>,
  ): Promise<{ session: Session; user: UserInterface } | null> {
    const headerObj =
      headers instanceof Headers
        ? fromNodeHeaders(
            Object.fromEntries(headers.entries()) as IncomingHttpHeaders,
          )
        : fromNodeHeaders(headers as IncomingHttpHeaders);

    const result = await this.auth.api.getSession({
      headers: headerObj,
    });

    if (!result) return null;

    return {
      session: this.mapSession(result.session as any),

      user: this.mapUser(result.user as any),
    };
  }

  async createInvitation(input: CreateInvitationInput): Promise<any> {
    if (!input.organizationId) {
      // System invite
      return this.createSystemInvitation(input);
    }

    // Org Invite via Better Auth API

    const api = this.auth.api as any;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    return await api.createInvitation({
      body: {
        email: input.email,
        role: input.role,
        organizationId: input.organizationId,
        expiresIn: input.expiresIn,
        inviterId: input.inviterId,
      },
    });
  }

  private async createSystemInvitation(input: CreateInvitationInput) {
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
    const inviteUrl = `${this.config.frontendUrl || this.config.allowedOrigins[0]}/invite/accept?id=${invitation.id}&email=${encodeURIComponent(invitation.email)}`;
    await this.emailService.sendEmail({
      to: input.email,
      subject: "You have been invited to join Nexiom",
      text: `You have been invited to join Nexiom. Click here to accept: ${inviteUrl}`,
      html: `<p>You have been invited to join <strong>Nexiom</strong>.</p><p><a href="${inviteUrl}">Click here to accept</a></p>`,
    });

    return invitation;
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
      if (inv?.status !== "pending" || inv.expiresAt < new Date()) {
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
          role: inv.role || "user",
          createdAt: new Date(),
        });
      } else {
        // System role
        await tx
          .update(schema.user)
          .set({ systemRole: inv.role })
          .where(eq(schema.user.id, userId));
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

  // --- Mappers ---
  private mapUser(dbUser: schema.User): UserInterface {
    return {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name || undefined,
      emailVerified: dbUser.emailVerified,
      image: dbUser.image || undefined,
      createdAt: dbUser.createdAt,
      updatedAt: dbUser.updatedAt,
      role: dbUser.role,
      systemRole: dbUser.systemRole || null,
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
      // Log warning or throw, for now fallback to pending or error??
      // Given DB strict schema usually prevents this, this is a TS guard.
      // If we fall here, it means DB has a value TS doesn't know.
      // We will fallback to pending or better: keep strict.
      // Schema uses text column but we should trust it slightly better if we had ENUM.
      // Here we map safely.
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
}

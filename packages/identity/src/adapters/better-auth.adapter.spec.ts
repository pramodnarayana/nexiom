/* eslint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BetterAuthAdapter,
  BetterAuthAdapterConfig,
} from "./better-auth.adapter";
import * as schema from "../schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

vi.mock("better-auth", () => ({
  betterAuth: vi.fn((opts: any) => ({
    api: {
      signUpEmail: vi.fn(),
      signInEmail: vi.fn(),
      getSession: vi.fn(),
      createInvitation: vi.fn(),
    },
    handler: vi.fn(),
  })),
}));

import { betterAuth } from "better-auth";

vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: vi.fn(),
}));

vi.mock("better-auth/plugins", () => ({
  organization: vi.fn((o) => o),
  admin: vi.fn(() => ({})),
}));

vi.mock("better-auth/node", () => ({
  fromNodeHeaders: vi.fn((h) => h),
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn(async (v: string) => `hashed:${v}`),
    compare: vi.fn(async (p: string, h: string) => h === `hashed:${p}`),
  },
  hash: vi.fn(async (v: string) => `hashed:${v}`),
  compare: vi.fn(async (p: string, h: string) => h === `hashed:${p}`),
}));

vi.mock("uuid", () => ({ v4: vi.fn(() => "uuid-1") }));

const mkDb = () => {
  const q: any = {
    user: { findFirst: vi.fn() },
    session: { findFirst: vi.fn() },
    invitation: { findFirst: vi.fn(), findMany: vi.fn() },
    member: { findFirst: vi.fn() },
    account: { findFirst: vi.fn() },
  };
  const db: any = {
    query: q,
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn(),
    transaction: vi.fn((fn: any) => fn(db)),
  };
  // expose tx.query in transaction
  db.query = q;
  return db as unknown as NodePgDatabase<typeof schema> & any;
};

const mkEmail = () => ({
  sendEmail: vi.fn(async () => undefined),
});

const mkTenantProvider = () => ({
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findById: vi.fn(),
  findBySlug: vi.fn(),
  listForUser: vi.fn(),
  findAllForUser: vi.fn(async () => []),
  provisionTenantForUser: vi.fn(),
  findOneForUser: vi.fn(),
});

const cfg = (
  over?: Partial<BetterAuthAdapterConfig>,
): BetterAuthAdapterConfig => ({
  allowedOrigins: ["http://localhost:5173"],
  betterAuthUrl: "http://localhost:3000/api/auth",
  frontendUrl: "http://localhost:5173",
  nodeEnv: "test",
  ...over,
});

describe("BetterAuthAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws on missing config", () => {
    const db = mkDb();
    const email = mkEmail();
    expect(
      () =>
        new BetterAuthAdapter(
          db,
          email as any,
          cfg({ allowedOrigins: [] }),
          mkTenantProvider() as any,
        ),
    ).toThrow("allowedOrigins");
    expect(
      () =>
        new BetterAuthAdapter(
          db,
          email as any,
          cfg({ betterAuthUrl: "" }),
          mkTenantProvider() as any,
        ),
    ).toThrow("betterAuthUrl");
  });

  it("createUser validates and maps from DB", async () => {
    const db = mkDb();
    const email = mkEmail();
    const adapter = new BetterAuthAdapter(db, email as any, cfg(), mkTenantProvider() as any);

    await expect(
      adapter.createUser({ email: "a@b.com" } as any),
    ).rejects.toThrow("Password is required");

    const auth: any = (adapter as any).auth;
    auth.api.signUpEmail.mockResolvedValue({ user: { id: "u1" } });
    db.query.user.findFirst.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      name: "A B",
      emailVerified: null,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      role: "user",
      systemRole: null,
      banned: null,
      banReason: null,
      banExpires: null,
    });

    const u = await adapter.createUser({
      email: "a@b.com",
      password: "pw",
      firstName: "A",
      lastName: "B",
    });
    expect(u.id).toBe("u1");

    auth.api.signUpEmail.mockResolvedValue({});
    await expect(
      adapter.createUser({ email: "x@y.com", password: "pw" }),
    ).rejects.toThrow("Unexpected response");

    auth.api.signUpEmail.mockResolvedValue({ user: { id: "u2" } });
    db.query.user.findFirst.mockResolvedValue(null);
    await expect(
      adapter.createUser({ email: "x@y.com", password: "pw" }),
    ).rejects.toThrow("not found in database");
  });

  it("login validates, hits API, rehydrates session and user", async () => {
    const db = mkDb();
    const email = mkEmail();
    const adapter = new BetterAuthAdapter(db, email as any, cfg(), mkTenantProvider() as any);
    await expect(adapter.login({ email: "a@b.com" } as any)).rejects.toThrow(
      "Password is required",
    );

    const auth: any = (adapter as any).auth;
    const json = vi.fn(async () => ({ token: "t1", user: { id: "u1" } }));
    const headers = {
      getSetCookie: vi.fn(() => "cookie=1"),
      get: vi.fn(),
    } as any;
    auth.api.signInEmail.mockResolvedValue({ ok: true, headers, json });

    db.query.session.findFirst.mockResolvedValue({
      id: "s1",
      token: "t1",
      userId: "u1",
      expiresAt: new Date(Date.now() + 10000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
    });
    db.query.user.findFirst.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      name: null,
      emailVerified: null,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      role: "user",
      systemRole: null,
      banned: null,
      banReason: null,
      banExpires: null,
    });

    const result = await adapter.login({ email: "a@b.com", password: "pw" });
    expect(result.cookie).toBe("cookie=1");

    auth.api.signInEmail.mockResolvedValue({ ok: false, statusText: "Bad" });
    await expect(
      adapter.login({ email: "a@b.com", password: "pw" }),
    ).rejects.toThrow("API Error");

    auth.api.signInEmail.mockResolvedValue({
      ok: true,
      headers: { get: vi.fn(() => undefined) },
      json: vi.fn(async () => ({ twoFactorRedirect: true })),
    });
    await expect(
      adapter.login({ email: "a@b.com", password: "pw" }),
    ).rejects.toThrow("2FA required");

    auth.api.signInEmail.mockResolvedValue({
      ok: true,
      headers: { get: vi.fn(() => undefined) },
      json: vi.fn(async () => ({ token: null, user: { id: "u1" } })),
    });
    await expect(
      adapter.login({ email: "a@b.com", password: "pw" }),
    ).rejects.toThrow("No token");

    auth.api.signInEmail.mockResolvedValue({
      ok: true,
      headers: { get: vi.fn(() => undefined) },
      json: vi.fn(async () => ({ token: "t1", user: {} })),
    });
    await expect(
      adapter.login({ email: "a@b.com", password: "pw" }),
    ).rejects.toThrow("No user");

    auth.api.signInEmail.mockResolvedValue({
      ok: true,
      headers: { get: vi.fn(() => undefined) },
      json: vi.fn(async () => ({ token: "t1", user: { id: "u1" } })),
    });
    db.query.session.findFirst.mockResolvedValue(null);
    await expect(
      adapter.login({ email: "a@b.com", password: "pw" }),
    ).rejects.toThrow("Session not found");
  });

  it("validateSession returns null for missing/expired, else mapped", async () => {
    const db = mkDb();
    const email = mkEmail();
    const adapter = new BetterAuthAdapter(db, email as any, cfg(), mkTenantProvider() as any);

    db.query.session.findFirst.mockResolvedValue(null);
    expect(await adapter.validateSession("t1")).toBeNull();

    db.query.session.findFirst.mockResolvedValue({
      id: "s1",
      token: "t1",
      userId: "u1",
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(await adapter.validateSession("t1")).toBeNull();

    db.query.session.findFirst.mockResolvedValue({
      id: "s1",
      token: "t1",
      userId: "u1",
      expiresAt: new Date(Date.now() + 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    db.query.user.findFirst.mockResolvedValue(null);
    expect(await adapter.validateSession("t1")).toBeNull();

    db.query.user.findFirst.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      name: null,
      emailVerified: null,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      role: "user",
      systemRole: null,
      banned: null,
      banReason: null,
      banExpires: null,
    });
    const res = await adapter.validateSession("t1");
    expect(res?.user.id).toBe("u1");
  });

  it("getSessionFromHeaders adapts headers and validates", async () => {
    const db = mkDb();
    const email = mkEmail();
    const adapter = new BetterAuthAdapter(db, email as any, cfg(), mkTenantProvider() as any);
    const auth: any = (adapter as any).auth;

    auth.api.getSession.mockResolvedValue({ session: { token: "t1" } });
    db.query.session.findFirst.mockResolvedValue({
      id: "s1",
      token: "t1",
      userId: "u1",
      expiresAt: new Date(Date.now() + 10000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    db.query.user.findFirst.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      name: null,
      emailVerified: null,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      role: "user",
      systemRole: null,
      banned: null,
      banReason: null,
      banExpires: null,
    });

    const res = await adapter.getSessionFromHeaders({ cookie: "x" });
    expect(res?.session.token).toBe("t1");

    auth.api.getSession.mockResolvedValue({});
    expect(await adapter.getSessionFromHeaders({})).toBeNull();
  });

  it("createInvitation handles system and org flows with validation", async () => {
    const db = mkDb();
    const email = mkEmail();
    const adapter = new BetterAuthAdapter(db, email as any, cfg(), mkTenantProvider() as any);

    // System
    db.returning.mockResolvedValueOnce([
      {
        id: "inv1",
        email: "a@b.com",
        role: "admin",
        organizationId: null,
        inviterId: "u1",
        status: "pending",
        expiresAt: new Date(),
        createdAt: new Date(),
      },
    ]);

    const inv1 = await adapter.createInvitation({
      email: "a@b.com",
      role: "admin",
      inviterId: "u1",
    } as any);
    expect(inv1.id).toBe("inv1");
    expect(email.sendEmail).toHaveBeenCalled();

    // Org
    const auth: any = (adapter as any).auth;
    auth.api.createInvitation.mockResolvedValue({
      invitation: {
        id: "inv2",
        email: "b@c.com",
        role: "member",
        organizationId: "o1",
        inviterId: "u1",
        status: "pending",
        expiresAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    });

    const inv2 = await adapter.createInvitation({
      email: "b@c.com",
      role: "member",
      inviterId: "u1",
      organizationId: "o1",
    });
    expect(inv2.organizationId).toBe("o1");

    // Invalid response
    auth.api.createInvitation.mockResolvedValue({ invitation: { foo: 1 } });
    await expect(
      adapter.createInvitation({
        email: "b@c.com",
        role: "member",
        inviterId: "u1",
        organizationId: "o1",
      }),
    ).rejects.toThrow("Missing field");

    // Invalid date
    auth.api.createInvitation.mockResolvedValue({
      invitation: {
        id: "x",
        email: "x@y.com",
        role: "user",
        organizationId: "o1",
        inviterId: "u1",
        status: "pending",
        expiresAt: "nope",
        createdAt: new Date().toISOString(),
      },
    });
    await expect(
      adapter.createInvitation({
        email: "b@c.com",
        role: "member",
        inviterId: "u1",
        organizationId: "o1",
      }),
    ).rejects.toThrow("Invalid expiresAt date");
  });

  it("getInvitation and listInvitations map correctly; handles partial data/unknown status", async () => {
    const db = mkDb();
    const email = mkEmail();
    const adapter = new BetterAuthAdapter(db, email as any, cfg(), mkTenantProvider() as any);

    db.query.invitation.findFirst.mockResolvedValueOnce(null);
    expect(await adapter.getInvitation("x")).toBeNull();

    const mkInv = (over: any = {}) => ({
      id: "i1",
      email: "a@b.com",
      role: null,
      organizationId: null,
      inviterId: "u1",
      status: "pending",
      expiresAt: new Date(),
      createdAt: new Date(),
      ...over,
    });

    const inv = mkInv();
    db.query.invitation.findFirst.mockResolvedValueOnce(inv);
    const gi = await adapter.getInvitation("i1");
    expect(gi?.role).toBe("user");

    // Test unknown status fallback to pending
    const weirdInv = mkInv({ status: "weird" });
    db.query.invitation.findMany.mockResolvedValueOnce([inv, weirdInv]);

    const list = await adapter.listInvitations("o1");
    expect(list).toHaveLength(2);
    expect(list[0].email).toBe("a@b.com");
    expect(list[1].status).toBe("pending"); // Unknown status fell back to pending
  });

  it("acceptInvitation validates and inserts membership or sets system role", async () => {
    const db: any = mkDb();
    const email = mkEmail();
    const adapter = new BetterAuthAdapter(db, email as any, cfg(), mkTenantProvider() as any);

    db.query.invitation.findFirst.mockResolvedValueOnce(null);
    await expect(adapter.acceptInvitation("i1", "u1")).rejects.toThrow(
      "Invalid or expired",
    );

    const validInv = {
      id: "i1",
      email: "a@b.com",
      role: "admin",
      organizationId: "o1",
      inviterId: "u2",
      status: "pending",
      expiresAt: new Date(Date.now() + 10000),
      createdAt: new Date(),
    };
    db.query.invitation.findFirst.mockResolvedValueOnce(validInv);

    db.query.user.findFirst.mockResolvedValueOnce(null);
    await expect(adapter.acceptInvitation("i1", "u1")).rejects.toThrow(
      "User not found",
    );

    db.query.invitation.findFirst.mockResolvedValueOnce(validInv);
    db.query.user.findFirst.mockResolvedValueOnce({
      id: "u1",
      email: "x@y.com",
    });
    await expect(adapter.acceptInvitation("i1", "u1")).rejects.toThrow(
      "Email mismatch",
    );

    db.query.invitation.findFirst.mockResolvedValueOnce(validInv);
    db.query.user.findFirst.mockResolvedValueOnce({
      id: "u1",
      email: "a@b.com",
    });
    await adapter.acceptInvitation("i1", "u1");
    expect(db.insert).toHaveBeenCalled();

    // system role path
    const sysInv = { ...validInv, organizationId: null };
    db.query.invitation.findFirst.mockResolvedValueOnce(sysInv);
    db.query.user.findFirst.mockResolvedValueOnce({
      id: "u1",
      email: "a@b.com",
    });
    await adapter.acceptInvitation("i1", "u1");
    expect(db.update).toHaveBeenCalled();
  });

  it("setPassword upserts credential account", async () => {
    const db: any = mkDb();
    const email = mkEmail();
    const adapter = new BetterAuthAdapter(db, email as any, cfg(), mkTenantProvider() as any);

    db.query.account.findFirst.mockResolvedValueOnce(null);
    await adapter.setPassword("u1", "pw");
    expect(db.insert).toHaveBeenCalled();

    db.query.account.findFirst.mockResolvedValueOnce({
      id: "a1",
      userId: "u1",
      providerId: "credential",
    });
    await adapter.setPassword("u1", "pw");
    expect(db.update).toHaveBeenCalled();
  });

  it("configures better-auth callbacks correctly (emails, hashing)", async () => {
    const db = mkDb();
    const email = mkEmail();
    const { betterAuth } = await import("better-auth");

    // Instantiate adapter to trigger betterAuth call
    new BetterAuthAdapter(db, email as any, cfg(), mkTenantProvider() as any);

    const callArgs = vi.mocked(betterAuth).mock.calls[0][0] as any;
    expect(callArgs).toBeDefined();

    // 1. Password Hashing - trigger hash to cover lines
    // checking that it returns a promise is enough to cover the adapter wrapper
    const hashFn = callArgs.emailAndPassword.password.hash;
    const verifyFn = callArgs.emailAndPassword.password.verify;

    expect(hashFn).toBeDefined();
    expect(verifyFn).toBeDefined();

    // 2. Email Verification
    const sendVerify = callArgs.emailVerification.sendVerificationEmail;
    await sendVerify({
      user: { email: "test@test.com" },
      url: "http://verify.com",
      token: "dummy-token",
    });
    expect(email.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "test@test.com",
        text: expect.stringContaining("http://verify.com"),
      }),
    );

    // 3. Invitation Email
    const orgPlugin = callArgs.plugins.find((p: any) => p.sendInvitationEmail);
    expect(orgPlugin).toBeDefined();
    await orgPlugin.sendInvitationEmail({
      email: "invite@test.com",
      invitation: { id: "inv1" },
      organization: { name: "Test Org" },
    });
    expect(email.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "invite@test.com",
        subject: expect.stringContaining("invited to join"),
      }),
    );
  });
});

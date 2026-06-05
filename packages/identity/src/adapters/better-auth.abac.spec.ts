import { describe, it, expect, vi, type Mock } from "vitest";
import { BetterAuthAdapter } from "./better-auth.adapter.js";
import type { IdentityModuleOptions } from "../identity.module.js";
import type { IEmailProvider, ITenantProvider } from "../interfaces/index.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema.js";

// Mocks
vi.mock("better-auth", () => ({
  betterAuth: vi.fn(() => ({ api: {}, handler: vi.fn() })),
}));
vi.mock("better-auth/adapters/drizzle", () => ({ drizzleAdapter: vi.fn() }));
vi.mock("better-auth/plugins", () => ({
  organization: vi.fn((o: unknown) => o),
  admin: vi.fn(() => ({})),
}));
vi.mock("better-auth/node", () => ({
  fromNodeHeaders: vi.fn((h: unknown) => h),
}));
vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn(), compare: vi.fn() },
  hash: vi.fn(),
  compare: vi.fn(),
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "uuid-1") }));

const mkDb = () => {
  return {
    query: {
      user: { findFirst: vi.fn() },
      session: { findFirst: vi.fn() },
      member: { findMany: vi.fn() },
      rolePermission: { findMany: vi.fn().mockResolvedValue([]) },
    },
  } as unknown as NodePgDatabase<typeof schema>;
};

const mkConfig = () => ({
  allowedOrigins: ["http://localhost:3000"],
  betterAuthUrl: "http://localhost:3000",
  nodeEnv: "test" as const,
});

const mkOptions = (): IdentityModuleOptions => ({
  betterAuthConfig: mkConfig(),
  constants: {
    systemTenantId: "sys",
    ownerRoleId: "owner",
    adminRoleId: "admin",
    memberRoleId: "member",
  },
});

describe("BetterAuthAdapter - ABAC Condition Mapping", () => {
  it("should serialize permissions with conditions as JSON strings", async () => {
    const db = mkDb();
    const mockEmail = { sendEmail: vi.fn() } as unknown as IEmailProvider;
    const mockTenantProvider = {} as unknown as ITenantProvider;
    const options = mkOptions();

    const adapter = new BetterAuthAdapter(
      db,
      mockEmail,
      mkConfig(),
      mockTenantProvider,
      options,
      { publishTenantProvisioned: vi.fn(), publishUserInvited: vi.fn() } as any,
    );

    // Mock DB User with Role containing Conditional Permission
    const mockUser = {
      id: "user_abac",
      email: "abac@test.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      members: [
        {
          id: "m1",
          userId: "user_abac",
          organizationId: "org1",
          role: {
            id: "restricted_admin",
            name: "Restricted Admin",
            permissions: [
              {
                permissionId: "users:delete",
                permission: { resource: "users", action: "delete" },
                conditions: { role: { $ne: "owner" } }, // The Condition
              },
            ],
          },
        },
      ],
    };

    // Inject mock safely
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const findFirstMock = db.query.user.findFirst as unknown as Mock;
    findFirstMock.mockResolvedValue(mockUser);

    const user = await adapter.findById("user_abac");

    // Expectation: The permission string should be a valid JSON object
    const permissions = user.permissions || [];
    const permissionString = permissions.find((p) => p.startsWith("{"));
    expect(permissionString).toBeDefined();

    const rule = JSON.parse(permissionString!) as {
      action: string;
      subject: string;
      conditions: Record<string, unknown>;
    };

    expect(rule).toMatchObject({
      action: "delete",
      subject: "users",
      conditions: { role: { $ne: "owner" } },
    });
  });
});

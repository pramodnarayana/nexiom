import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { DrizzlePermissionAdapter } from "./drizzle-permission.adapter";
import * as schema from "../schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { User } from "../interfaces";
import { SYSTEM_TENANT_ID } from "../constants";

const mockChainedQuery = (result: unknown) => {
  const p = Promise.resolve(result);

  const chain: any = Object.assign(p, {});

  const methods = [
    "from",
    "innerJoin",
    "leftJoin",
    "where",
    "select",
    "limit",
    "offset",
    "orderBy",
  ];
  methods.forEach((m) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return chain;
};

interface MockDb {
  select: Mock;
  from: Mock;
  innerJoin: Mock;
  leftJoin: Mock;
  where: Mock;
  limit: Mock;
  offset: Mock;
  orderBy: Mock;
}

const mkDb = () => {
  const db: MockDb = {
    select: vi.fn(),
    from: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    orderBy: vi.fn(),
  };
  return db as unknown as NodePgDatabase<typeof schema> & MockDb;
};

const mkUser = (over?: Partial<User>): User => ({
  id: "u1",
  email: "a@b.com",
  name: null,
  emailVerified: false,
  image: undefined,
  createdAt: new Date(),
  updatedAt: new Date(),
  role: "user",
  banned: false,
  banReason: null,
  banExpires: null,
  ...over,
});

describe("DrizzlePermissionAdapter", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("can: tenant checks - Owner true, others based on permissions", async () => {
    const db = mkDb();
    const adapter = new DrizzlePermissionAdapter(db);
    const user = mkUser();

    // no membership
    db.select.mockReturnValue(mockChainedQuery([]));
    expect(await adapter.can(user, "read", "organization", "o1")).toBe(false);

    // Owner (name checks out)
    db.select.mockReturnValue(
      mockChainedQuery([
        {
          roleId: "owner",
          roleName: "Owner",
          permId: null,
          resource: null,
          action: null,
        },
      ]),
    );
    expect(await adapter.can(user, "update", "organization", "o1")).toBe(true);

    // Regular member with specific permission
    db.select.mockReturnValue(
      mockChainedQuery([
        {
          roleId: "member",
          roleName: "Member",
          permId: "p1",
          resource: "organization",
          action: "read",
        },
      ]),
    );
    expect(await adapter.can(user, "read", "organization", "o1")).toBe(true);

    // Regular member missing permission
    db.select.mockReturnValue(
      mockChainedQuery([
        {
          roleId: "member",
          roleName: "Member",
          permId: "p1",
          resource: "other", // mismatch
          action: "read",
        },
      ]),
    );
    expect(await adapter.can(user, "update", "organization", "o1")).toBe(false);
  });

  it("hasRole: checks role id", async () => {
    const db = mkDb();
    const adapter = new DrizzlePermissionAdapter(db);
    const user = mkUser();

    db.select.mockReturnValue(
      mockChainedQuery([
        {
          roleId: "admin",
          roleName: "Admin",
          permId: null,
        },
      ]),
    );
    expect(await adapter.hasRole(user, "admin", "o1")).toBe(true);

    db.select.mockReturnValue(
      mockChainedQuery([
        {
          roleId: "user",
          roleName: "User",
          permId: null,
        },
      ]),
    );
    expect(await adapter.hasRole(user, "admin", "o1")).toBe(false);
  });

  it("getPermissions: aggregates wildcard and role-based perms", async () => {
    const db = mkDb();
    const adapter = new DrizzlePermissionAdapter(db);

    // tenant member: user with permissions
    db.select.mockReturnValue(
      mockChainedQuery([
        {
          roleId: "custom_role",
          roleName: "Custom",
          permId: "users:read",
          resource: "users",
          action: "read",
        },
      ]),
    );
    expect(await adapter.getPermissions(mkUser(), "o1")).toEqual([
      "users:read",
    ]);

    // tenant member not found
    db.select.mockReturnValue(mockChainedQuery([]));
    expect(await adapter.getPermissions(mkUser(), "o1")).toEqual([]);
  });

  it("getPermissions: returns * for system admin if DB returns it", async () => {
    const db = mkDb();
    const adapter = new DrizzlePermissionAdapter(db);

    // Mock DB to return '*' permission for system tenant query
    db.select.mockReturnValue(
      mockChainedQuery([
        {
          permId: "*",
          resource: "*",
          action: "*",
        },
      ]),
    );

    // Pass SYSTEM_TENANT_ID or rely on default if implementation handles it?
    // Implementation requires tenantId usually.
    expect(await adapter.getPermissions(mkUser(), SYSTEM_TENANT_ID)).toEqual([
      "*",
    ]);
  });
});

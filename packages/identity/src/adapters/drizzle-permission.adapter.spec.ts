/* eslint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DrizzlePermissionAdapter } from "./drizzle-permission.adapter";
import * as schema from "../schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { User } from "../interfaces";

const mockChainedQuery = (result: unknown) => {
  const chain: Record<string, any> = {
    then: (onfulfilled: (value: unknown) => unknown) =>
      Promise.resolve(result).then(onfulfilled),
  };
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
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  return chain;
};

const mkDb = () => {
  const db: any = {
    select: vi.fn(),
  };
  return db as unknown as NodePgDatabase<typeof schema> & any;
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
  systemRole: null,
  banned: false,
  banReason: null,
  banExpires: null,
  ...over,
});

describe("DrizzlePermissionAdapter", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("can: platform_admin always true", async () => {
    const db = mkDb();
    const adapter = new DrizzlePermissionAdapter(db);
    const user = mkUser({ systemRole: "platform_admin" });
    expect(await adapter.can(user, "delete", "organization", undefined)).toBe(
      true,
    );
  });

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

    // platform admin
    expect(
      await adapter.getPermissions(mkUser({ systemRole: "platform_admin" })),
    ).toEqual(["*"]);

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
      "role:custom_role",
      "users:read",
    ]);

    // tenant member not found
    db.select.mockReturnValue(mockChainedQuery([]));
    expect(await adapter.getPermissions(mkUser(), "o1")).toEqual([]);
  });
});

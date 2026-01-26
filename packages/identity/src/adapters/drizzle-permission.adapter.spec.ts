/* eslint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DrizzlePermissionAdapter } from "./drizzle-permission.adapter";
import * as schema from "../schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { User } from "../interfaces";

const mkDb = () => {
  const q: any = {
    member: { findFirst: vi.fn() },
  };
  const db: any = {
    query: q,
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

  it("can: tenant checks - admin/owner true, user read only, others false", async () => {
    const db = mkDb();
    const adapter = new DrizzlePermissionAdapter(db);
    const user = mkUser();

    // no membership
    db.query.member.findFirst.mockResolvedValueOnce(null);
    expect(await adapter.can(user, "read", "organization", "o1")).toBe(false);

    // admin
    db.query.member.findFirst.mockResolvedValueOnce({ role: "admin" });
    expect(await adapter.can(user, "update", "organization", "o1")).toBe(true);

    // owner
    db.query.member.findFirst.mockResolvedValueOnce({ role: "owner" });
    expect(await adapter.can(user, "update", "organization", "o1")).toBe(true);

    // user read true
    db.query.member.findFirst.mockResolvedValueOnce({ role: "user" });
    expect(await adapter.can(user, "read", "organization", "o1")).toBe(true);

    // user update false
    db.query.member.findFirst.mockResolvedValueOnce({ role: "user" });
    expect(await adapter.can(user, "update", "organization", "o1")).toBe(false);
  });

  it("can: non-tenant user-level update returns false", async () => {
    const db = mkDb();
    const adapter = new DrizzlePermissionAdapter(db);
    const user = mkUser();
    expect(await adapter.can(user, "update", "user", undefined)).toBe(false);
  });

  it("hasRole: tenant and system paths", async () => {
    const db = mkDb();
    const adapter = new DrizzlePermissionAdapter(db);
    const user = mkUser();

    db.query.member.findFirst.mockResolvedValueOnce({ role: "admin" });
    expect(await adapter.hasRole(user, "admin", "o1")).toBe(true);

    db.query.member.findFirst.mockResolvedValueOnce({ role: "user" });
    expect(await adapter.hasRole(user, "admin", "o1")).toBe(false);

    expect(await adapter.hasRole(mkUser(), "platform_admin")).toBe(false);
    expect(
      await adapter.hasRole(
        mkUser({ systemRole: "platform_admin" }),
        "platform_admin",
      ),
    ).toBe(true);
  });

  it("getPermissions: aggregates wildcard and role-based perms", async () => {
    const db = mkDb();
    const adapter = new DrizzlePermissionAdapter(db);

    // platform admin
    expect(
      await adapter.getPermissions(mkUser({ systemRole: "platform_admin" })),
    ).toEqual(["*"]);

    // tenant member: user
    db.query.member.findFirst.mockResolvedValueOnce({ role: "user" });
    expect(await adapter.getPermissions(mkUser(), "o1")).toEqual(["role:user"]);

    // admin adds manage:tenant
    db.query.member.findFirst.mockResolvedValueOnce({ role: "admin" });
    expect(await adapter.getPermissions(mkUser(), "o1")).toEqual([
      "role:admin",
      "manage:tenant",
    ]);
  });
});

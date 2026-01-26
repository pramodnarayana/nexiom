/* eslint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DrizzleUserAdapter } from "./drizzle-user.adapter";
import * as schema from "../schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  IAuthProvider,
  CreateUserInput,
  UpdateUserInput,
} from "../interfaces";

const mkDb = () => {
  const q: any = {
    user: { findFirst: vi.fn() },
    member: { findFirst: vi.fn() },
    invitation: { findFirst: vi.fn() },
  };
  const tx: any = {
    delete: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  };
  const db: any = {
    query: q,
    transaction: vi.fn(async (fn: any) => fn(tx)),
    delete: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
  };
  db.select.mockReturnValue(db);
  return db as unknown as NodePgDatabase<typeof schema> & any;
};

const mkAuth = (over?: Partial<IAuthProvider>): IAuthProvider =>
  ({
    createUser: vi.fn(async (input: any) => ({
      id: "u1",
      email: input.email,
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
    })),
    setPassword: vi.fn(async () => undefined),
    ...over,
  }) as unknown as IAuthProvider;

const mkUser = (over?: Partial<schema.User>): schema.User =>
  ({
    id: "u1",
    email: "a@b.com",
    name: null,
    emailVerified: false,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: "user",
    systemRole: null,
    banned: false,
    banReason: null,
    banExpires: null,
    ...over,
  }) as unknown as schema.User;

describe("DrizzleUserAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("create delegates to auth provider; applies systemRole with compensation on failure", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserAdapter(db, auth);

    // No systemRole
    const user = await adapter.create({
      email: "a@b.com",
      password: "pw",
    } as CreateUserInput);
    expect(user.id).toBe("u1");

    // With systemRole, update succeeds
    db.query.user.findFirst.mockResolvedValueOnce(mkUser());
    await adapter.create({
      email: "a@b.com",
      password: "pw",
      systemRole: "admin",
    } as CreateUserInput);

    // With systemRole, update throws -> triggers delete compensation
    const failing = new DrizzleUserAdapter(db, auth);
    db.query.user.findFirst.mockRejectedValueOnce(new Error("update failed"));
    const spyDelete = vi.spyOn(failing, "delete").mockResolvedValue();
    await expect(
      failing.create({
        email: "x@y.com",
        password: "pw",
        systemRole: "admin",
      } as CreateUserInput),
    ).rejects.toThrow("update failed");
    expect(spyDelete).toHaveBeenCalled();
  });

  it("update handles password via auth provider; updates fields; throws if missing user after update", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserAdapter(db, auth);

    // password path
    db.query.user.findFirst.mockResolvedValueOnce(mkUser({ id: "u1" }));
    await adapter.update("u1", { password: "newpw" } as UpdateUserInput);
    expect(auth.setPassword).toHaveBeenCalledWith("u1", "newpw");

    // field update path
    // first: prior read for some branches is not guaranteed; ensure final read returns a user
    db.query.user.findFirst.mockResolvedValueOnce(
      mkUser({ id: "u1", name: "A" }),
    );
    const res = await adapter.update("u1", { name: "A" } as UpdateUserInput);
    expect(res.name).toBe("A");

    // missing setPassword support
    const adapter2 = new DrizzleUserAdapter(db, {
      createUser: auth.createUser,
    } as any);
    await expect(
      adapter2.update("u1", { password: "x" } as UpdateUserInput),
    ).rejects.toThrow("Password updates are not supported");

    // user not found after update
    db.query.user.findFirst.mockResolvedValueOnce(null);
    await expect(adapter.update("u1", {} as UpdateUserInput)).rejects.toThrow(
      "User not found after update",
    );
  });

  it("delete cascades and related tables in a transaction", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserAdapter(db, auth);

    await adapter.delete("u1");
    expect(db.transaction).toHaveBeenCalled();
  });

  it("findById and findByEmail return mapped or null", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserAdapter(db, auth);

    db.query.user.findFirst.mockResolvedValueOnce(mkUser({ id: "u1" }));
    const byId = await adapter.findById("u1");
    expect(byId?.id).toBe("u1");

    db.query.user.findFirst.mockResolvedValueOnce(null);
    expect(await adapter.findById("x")).toBeNull();

    db.query.user.findFirst.mockResolvedValueOnce(mkUser({ email: "z@y.com" }));
    const byEmail = await adapter.findByEmail("z@y.com");
    expect(byEmail?.email).toBe("z@y.com");

    db.query.user.findFirst.mockResolvedValueOnce(null);
    expect(await adapter.findByEmail("x@y.com")).toBeNull();
  });

  it("findAll supports tenant-scoped and global listing with pagination and search/systemRole filters", async () => {
    const db: any = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserAdapter(db, auth);

    const users = [mkUser({ id: "u1" }), mkUser({ id: "u2" })];

    // tenant-scoped path (innerJoin)
    db.select.mockReturnValueOnce({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: () => ({
              offset: () => ({
                orderBy: () =>
                  Promise.resolve([{ user: users[0] }, { user: users[1] }]),
              }),
            }),
          }),
        }),
      }),
    });
    db.select.mockReturnValueOnce({
      from: () => ({
        innerJoin: () => ({ where: () => Promise.resolve([{ count: 2 }]) }),
      }),
    });

    const scoped = await adapter.findAll({
      tenantId: "o1",
      page: 1,
      limit: 10,
      search: "a",
      systemRole: "admin",
    });
    expect(scoped.total).toBe(2);

    // global path
    db.select.mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => ({
            offset: () => ({ orderBy: () => Promise.resolve(users) }),
          }),
        }),
      }),
    });
    db.select.mockReturnValueOnce({
      from: () => ({ where: () => Promise.resolve([{ count: 2 }]) }),
    });

    const global = await adapter.findAll({
      page: 1,
      limit: 10,
      search: "a",
      systemRole: "admin",
    });
    expect(global.data).toHaveLength(2);
  });

  it("count supports tenant and global paths", async () => {
    const db: any = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserAdapter(db, auth);

    // tenant path
    db.select.mockReturnValueOnce({
      from: () => ({
        innerJoin: () => ({ where: () => Promise.resolve([{ count: 5 }]) }),
      }),
    });
    expect(
      await adapter.count({ tenantId: "o1", search: "a", systemRole: "admin" }),
    ).toBe(5);

    // global path
    db.select.mockReturnValueOnce({
      from: () => ({ where: () => Promise.resolve([{ count: 3 }]) }),
    });
    expect(await adapter.count({ search: "a", systemRole: "admin" })).toBe(3);
  });

  it("forceVerifyEmail updates verification flag", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserAdapter(db, auth);

    await adapter.forceVerifyEmail("u1");
    expect(db.update).toHaveBeenCalled();
  });
});

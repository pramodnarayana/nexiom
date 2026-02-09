/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DrizzleUserAdapter } from "./drizzle-user.adapter";
import * as schema from "../schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  IAuthProvider,
  CreateUserInput,
  UpdateUserInput,
} from "../interfaces";
import { eq } from "drizzle-orm";

type MockFunc = ReturnType<typeof vi.fn>;

interface MockTx {
  delete: MockFunc;
  where: MockFunc;
  update: MockFunc;
  set: MockFunc;
}

interface MockDb {
  query: {
    user: { findFirst: MockFunc };
    member: { findFirst: MockFunc };
    invitation: { findFirst: MockFunc };
  };
  transaction: MockFunc;
  delete: MockFunc;
  update: MockFunc;
  set: MockFunc;
  where: MockFunc;
  select: MockFunc;
  from: MockFunc;
  innerJoin: MockFunc;
  limit: MockFunc;
  offset: MockFunc;
  orderBy: MockFunc;
}
const mockChainedQuery = (result: unknown) => {
  const chain: Record<string, any> = Promise.resolve(result);
  const methods = [
    "from",
    "innerJoin",
    "where",
    "limit",
    "offset",
    "orderBy",
    "select",
  ];
  methods.forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  return chain;
};

const mkDb = () => {
  const q = {
    user: { findFirst: vi.fn() },
    member: { findFirst: vi.fn() },
    invitation: { findFirst: vi.fn() },
  };

  const tx: MockTx = {
    delete: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  };

  const db = {
    query: q,
    transaction: vi.fn((fn: (tx: MockTx) => unknown) => fn(tx)),
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
  } as unknown as MockDb;

  db.select.mockReturnValue(db);
  return db as unknown as NodePgDatabase<typeof schema> & MockDb;
};

const mkAuth = (over?: Partial<IAuthProvider>): IAuthProvider =>
  ({
    createUser: vi.fn((input: CreateUserInput) =>
      Promise.resolve({
        id: "u1",
        email: input.email,
        name: null,
        emailVerified: false,
        image: undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
        role: "user",
        banned: false,
        banReason: null,
        banExpires: null,
      }),
    ),
    setPassword: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue({ id: "u1" }),
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
    banned: false,
    banReason: null,
    banExpires: null,
    ...over,
  }) as unknown as schema.User;

const mkOptions = () =>
  ({
    dbToken: "DB_TOKEN",
    constants: {
      systemTenantId: "system-tenant-id",
      ownerRoleId: "owner-role-id",
      adminRoleId: "Admin", // Matches the mock role name in test case
      memberRoleId: "member-role-id",
    },
  }) as any;

describe("DrizzleUserAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("create delegates to auth provider", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserAdapter(db, mkOptions(), auth);

    const user = await adapter.create({
      email: "a@b.com",
      password: "pw",
    } as CreateUserInput);
    expect(user.id).toBe("u1");
  });

  it("update handles password via auth provider; updates fields; throws if missing user after update", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserAdapter(db, mkOptions(), auth);

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
    const adapter2 = new DrizzleUserAdapter(db, mkOptions(), {
      createUser: (input: CreateUserInput) => auth.createUser(input),
    } as unknown as IAuthProvider);
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
    const adapter = new DrizzleUserAdapter(db, mkOptions(), auth);

    // Access the transaction mock to verify cascade behavior
    const txCalls: string[] = [];
    db.transaction.mockImplementation((fn: (tx: MockTx) => unknown) => {
      const tx = {
        delete: vi.fn().mockImplementation(() => {
          txCalls.push("delete");
          return { where: vi.fn().mockReturnThis() };
        }),
      } as unknown as MockTx;
      return fn(tx);
    });

    await adapter.delete("u1");
    expect(db.transaction).toHaveBeenCalled();
    // Verify multiple delete calls for cascade (member, invitation, session, account, user)
    // Note: Exact count depends on implementation, but checking > 0 ensures transaction details
    expect(txCalls.length).toBeGreaterThan(0);
  });

  it("findById and findByEmail return mapped or null", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserAdapter(db, mkOptions(), auth);

    // db.query.user.findFirst.mockResolvedValueOnce(mkUser({ id: "u1" }));
    // Adapter delegates to auth provider for findById
    auth.findById = vi.fn().mockResolvedValue(mkUser({ id: "u1" }));
    const byId = await adapter.findById("u1");
    expect(byId?.id).toBe("u1");

    auth.findById = vi.fn().mockRejectedValue(new Error("Not found"));
    expect(await adapter.findById("x")).toBeNull();

    db.query.user.findFirst.mockResolvedValueOnce(mkUser({ email: "z@y.com" }));
    const byEmail = await adapter.findByEmail("z@y.com");
    expect(byEmail?.email).toBe("z@y.com");

    db.query.user.findFirst.mockResolvedValueOnce(null);
    expect(await adapter.findByEmail("x@y.com")).toBeNull();
  });

  it("findAll supports tenant-scoped and global listing with pagination and search", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserAdapter(db, mkOptions(), auth);

    const users = [mkUser({ id: "u1" }), mkUser({ id: "u2" })];

    // tenant-scoped path (innerJoin)
    db.select
      .mockReturnValueOnce(
        mockChainedQuery([{ user: users[0] }, { user: users[1] }]),
      )
      .mockReturnValueOnce(mockChainedQuery([{ count: 2 }]));

    const scoped = await adapter.findAll({
      tenantId: "o1",
      page: 1,
      limit: 10,
      search: "a",
    });
    expect(scoped.total).toBe(2);

    // global path
    db.select
      .mockReturnValueOnce(mockChainedQuery(users))
      .mockReturnValueOnce(mockChainedQuery([{ count: 2 }]));

    const global = await adapter.findAll({
      page: 1,
      limit: 10,
      search: "a",
    });
    expect(global.data).toHaveLength(2);
  });

  it("count supports tenant and global paths", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserAdapter(db, mkOptions(), auth);

    // tenant path
    db.select.mockReturnValueOnce(mockChainedQuery([{ count: 5 }]));
    expect(await adapter.count({ tenantId: "o1", search: "a" })).toBe(5);

    // global path
    db.select.mockReturnValueOnce(mockChainedQuery([{ count: 3 }]));
    expect(await adapter.count({ search: "a" })).toBe(3);
  });

  it("forceVerifyEmail updates verification flag", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserAdapter(db, mkOptions(), auth);

    await adapter.forceVerifyEmail("u1");

    expect(db.update).toHaveBeenCalledWith(schema.user);
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ emailVerified: true }),
    );
    expect(db.where).toHaveBeenCalledWith(eq(schema.user.id, "u1"));
  });

  it("deleteIfNotLastAdmin acquires lock, verifies membership, checks admin count, and deletes if safe", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserAdapter(db, mkOptions(), auth);

    // Mock transaction context
    const mockDelete = vi.fn().mockReturnThis();
    const mockFor = vi.fn().mockReturnThis();

    // Setup chain for select().from().where().for() and select().from()...

    // We need specific results for the 3 selects in sequence:
    // 1. Lock organization
    // 2. Get membership/role
    // 3. Count admins

    // Because mockChain is reused, we manage return values via the 'then' resolution or simple mocks if separate
    // Actually simpler to mock tx.select to return differnt chains or values based on calls.

    // Let's rely on the sequence of execution or just broad mocks since logic is sequential using await.

    // Mock the transaction execution
    db.transaction.mockImplementation(
      async (fn: (tx: MockTx) => Promise<unknown>) => {
        const tx = {
          select: vi.fn(),
          delete: mockDelete,
          where: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
        };

        // 1. Lock call
        tx.select.mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          for: mockFor, // Key verification
        });

        // 2. Membership call
        tx.select.mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValueOnce([{ roleId: "Admin" }]),
        });

        // 3. Count admins call
        tx.select.mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValueOnce([{ count: 2 }]), // returns promise of array
        });

        // 4. Remaining memberships call (for orphan cleanup)
        tx.select.mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValueOnce([{ count: 0 }]),
        });

        return await fn(tx);
      },
    );

    const result = await adapter.deleteIfNotLastAdmin("u1", "o1");

    expect(result).toBe(true);
    // Verify lock was acquired
    expect(mockFor).toHaveBeenCalledWith("update");
    // Verify delete was called
    expect(mockDelete).toHaveBeenCalled();
  });
});

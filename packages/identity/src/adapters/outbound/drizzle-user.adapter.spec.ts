/* eslint-disable @typescript-eslint/no-unsafe-return */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DrizzleUserRepositoryAdapter } from "./drizzle-user.adapter.js";
import * as schema from "../../schema.js";
import { UserNotFoundError } from "../../core/ports/outbound/index.js";
import type { IdentityModuleOptions } from "../../identity.module.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  IAuthProvider,
  CreateUserInput,
  UpdateUserInput,
} from "../../core/ports/outbound/index.js";

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
        role: "member",
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
    role: "member",
    banned: false,
    banReason: null,
    banExpires: null,
    ...over,
  }) as unknown as schema.User;

const mkOptions = (): IdentityModuleOptions => ({
  dbToken: "DB_TOKEN",
  constants: {
    systemTenantId: "system-tenant-id",
    ownerRoleId: "owner-role-id",
    adminRoleId: "admin-role-id",
    memberRoleId: "member-role-id",
  },
  // Minimal stub — DrizzleUserRepositoryAdapter does not use betterAuthConfig directly;
  // it is required by IdentityModuleOptions but unused in this adapter's logic.
  betterAuthConfig: {
    allowedOrigins: [],
    betterAuthUrl: "http://localhost:3000",
  },
});

describe("DrizzleUserRepositoryAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("create delegates to auth provider", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserRepositoryAdapter(db, mkOptions(), auth);

    const user = await adapter.create({
      email: "a@b.com",
      password: "pw",
    } as CreateUserInput);
    expect(user.id).toBe("u1");
  });

  it("update handles password via auth provider; updates fields; throws if missing user after update", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserRepositoryAdapter(db, mkOptions(), auth);

    // password path
    db.query.user.findFirst.mockResolvedValueOnce(mkUser({ id: "u1" }));
    await adapter.update("u1", { password: "newpw" } as UpdateUserInput);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(auth.setPassword).toHaveBeenCalledWith("u1", "newpw");

    // field update path
    // first: prior read for some branches is not guaranteed; ensure final read returns a user
    db.query.user.findFirst.mockResolvedValueOnce(
      mkUser({ id: "u1", name: "A" }),
    );
    const res = await adapter.update("u1", { name: "A" } as UpdateUserInput);
    expect(res.name).toBe("A");

    // missing setPassword support
    const adapter2 = new DrizzleUserRepositoryAdapter(db, mkOptions(), {
      createUser: (input: CreateUserInput) => auth.createUser(input),
    } as unknown as IAuthProvider);
    await expect(
      adapter2.update("u1", { password: "x" } as UpdateUserInput),
    ).rejects.toThrow("Password updates are not supported");

    // Verify update with ONLY password does not trigger DB update
    db.update.mockClear();
    db.query.user.findFirst.mockResolvedValueOnce(mkUser({ id: "u1" }));
    await adapter.update("u1", { password: "pw" } as UpdateUserInput);

    expect(db.update).not.toHaveBeenCalled();
  });

  it("delete cascades and related tables in a transaction", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserRepositoryAdapter(db, mkOptions(), auth);

    // Access the transaction mock to verify cascade behavior
    const txCalls: any[] = [];
    db.transaction.mockImplementation((fn: (tx: MockTx) => unknown) => {
      const tx = {
        delete: vi.fn().mockImplementation((table: any) => {
          txCalls.push(table);
          return { where: vi.fn().mockReturnThis() };
        }),
      } as unknown as MockTx;
      return fn(tx);
    });

    await adapter.delete("u1");

    expect(db.transaction).toHaveBeenCalled();
    expect(txCalls).toHaveLength(5);
    expect(txCalls).toEqual([
      schema.member,
      schema.invitation,
      schema.session,
      schema.account,
      schema.user,
    ]);
  });

  it("findById and findByEmail return mapped or null", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserRepositoryAdapter(db, mkOptions(), auth);

    auth.findById = vi.fn().mockResolvedValue(mkUser({ id: "u1" }));
    const byId = await adapter.findById("u1");
    expect(byId?.id).toBe("u1");

    auth.findById = vi.fn().mockRejectedValue(new Error("Not found"));
    expect(await adapter.findById("x")).toBeNull();

    // Fallback path when authProvider.findById is missing
    const authNoFind = mkAuth();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    delete (authNoFind as any).findById;
    const adapterFallback = new DrizzleUserRepositoryAdapter(
      db,
      mkOptions(),
      authNoFind,
    );

    db.query.user.findFirst.mockResolvedValueOnce(mkUser({ id: "u2" }));
    const byIdFallback = await adapterFallback.findById("u2");
    expect(byIdFallback?.id).toBe("u2");

    db.query.user.findFirst.mockResolvedValueOnce(mkUser({ email: "z@y.com" }));
    const byEmail = await adapter.findByEmail("z@y.com");
    expect(byEmail?.email).toBe("z@y.com");

    db.query.user.findFirst.mockResolvedValueOnce(null);
    expect(await adapter.findByEmail("x@y.com")).toBeNull();

    // Generic error path (rethrows)
    auth.findById = vi.fn().mockRejectedValue(new Error("Explosion"));
    await expect(adapter.findById("u1")).rejects.toThrow("Explosion");

    // Provider specific "Not found" error (text match) - returns null
    // Matches /\bnot found\b/i
    auth.findById = vi.fn().mockRejectedValue(new Error("User Not Found"));
    expect(await adapter.findById("u1")).toBeNull();

    // Specific UserNotFoundError path - returns null
    auth.findById = vi.fn().mockRejectedValue(new UserNotFoundError("u1"));
    expect(await adapter.findById("u1")).toBeNull();
  });

  it("deleteIfNotLastAdmin handles various scenarios", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserRepositoryAdapter(db, mkOptions(), auth);

    const mockSelect = vi.fn();
    const mockTx = {
      select: mockSelect,
      delete: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };

    db.transaction.mockImplementation((fn: (tx: any) => any) => fn(mockTx));

    // Helper to mock the chain of selects based on parameters
    // dispatched via a single mock implementation
    const setupMocks = (
      membership: any[],
      adminCount: any[],
      remainingMemberships: any[],
      tenantExists: boolean = true,
    ) => {
      mockSelect.mockReset();

      mockSelect.mockImplementation(
        (columns: Record<string, any> | undefined) => {
          const chain = {
            from: vi.fn(),
            innerJoin: vi.fn(),
            where: vi.fn(),
            for: vi.fn(),
            limit: vi.fn(),
          };

          chain.from.mockReturnValue(chain);
          chain.innerJoin.mockReturnValue(chain);
          chain.where.mockReturnValue(chain);
          chain.for.mockReturnValue(chain);
          chain.limit.mockReturnValue(chain);

          // 1. Lock
          if (columns?.id && !columns.memberId) {
            chain.for.mockResolvedValue(tenantExists ? [{ id: "org" }] : []);
            return chain;
          }

          // 2. Membership
          if (columns?.memberId && columns?.roleId) {
            chain.limit.mockResolvedValue(membership);
            return chain;
          }

          // 3. Counts
          if (columns?.count) {
            const thenableChain = {
              ...chain,

              then: (resolve: (val: any) => void) => {
                // Differentiate queries based on chain structure (stable detection)
                // Admin Count Query: .select({ count }).from(member).innerJoin(role)...
                // Remaining Memberships: .select({ count }).from(member).where(...) -> NO innerJoin

                const hasInnerJoin = chain.innerJoin.mock.calls.length > 0;
                const hasLimit = chain.limit.mock.calls.length > 0;

                if (hasInnerJoin) {
                  resolve(adminCount);
                } else if (hasLimit) {
                  // Fallback for logic that uses limit with count (unlikely in current adapter but safe)
                  resolve(membership);
                } else {
                  // Remaining memberships query (no join, no limit)
                  resolve(remainingMemberships);
                }
              },
            };

            chain.where.mockReturnValue(thenableChain as any);
            chain.from.mockReturnValue(thenableChain as any);
            chain.innerJoin.mockReturnValue(thenableChain as any);

            return thenableChain;
          }

          return chain;
        },
      );
    };

    // Scenario 0: Tenant not found
    setupMocks([], [], [], false);
    await expect(adapter.deleteIfNotLastAdmin("u1", "o1")).rejects.toThrow(
      "Organization not found",
    );

    // Scenario 1: User not member
    setupMocks([], [], []);
    await expect(adapter.deleteIfNotLastAdmin("u1", "o1")).rejects.toThrow(
      "User is not a member",
    );

    // Scenario 2: Last Admin (Prevention)
    setupMocks(
      [{ roleId: "admin-role-id" }],
      [{ count: 1 }],
      [], // won't be reached
    );
    const resultLastAdmin = await adapter.deleteIfNotLastAdmin("u1", "o1");
    expect(resultLastAdmin.success).toBe(false);

    // Scenario 3: Admin, but not last (Success, no hard delete)
    setupMocks(
      [{ roleId: "admin-role-id" }],
      [{ count: 2 }],
      [{ count: 1 }], // has other memberships
    );
    const resultNotLast = await adapter.deleteIfNotLastAdmin("u1", "o1");
    expect(resultNotLast.success).toBe(true);
    expect(resultNotLast.hardDeleted).toBe(false);

    // Scenario 4: Member (Success, hard delete)
    // Uses the simplified setupMocks now
    setupMocks(
      [{ roleId: "member-role-id" }],
      [], // Admin count not checked for members
      [{ count: 0 }], // Remaining memberships
    );

    const resultHardDelete = await adapter.deleteIfNotLastAdmin("u1", "o1");
    expect(resultHardDelete.success).toBe(true);
    expect(resultHardDelete.hardDeleted).toBe(true);
  });

  it("forceVerifyEmail updates user", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserRepositoryAdapter(db, mkOptions(), auth);

    await adapter.forceVerifyEmail("u1");

    expect(db.update).toHaveBeenCalledWith(schema.user);

    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ emailVerified: true }),
    );

    expect(db.where).toHaveBeenCalled();
  });

  it("count returns total users with optional filtering", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserRepositoryAdapter(db, mkOptions(), auth);

    // Mock count result
    const mockCountResult = [{ count: 5 }];
    db.select.mockReturnThis();
    db.from.mockReturnThis();
    db.innerJoin.mockReturnThis();
    db.where.mockReturnValue(mockCountResult);

    // 1. Global count
    const total = await adapter.count();
    expect(total).toBe(5);

    expect(db.innerJoin).not.toHaveBeenCalled();

    // 2. Tenant count
    db.innerJoin.mockClear();
    const totalTenant = await adapter.count({ tenantId: "t1" });
    expect(totalTenant).toBe(5);

    expect(db.innerJoin).toHaveBeenCalled();
  });

  it("findAll builds search filters correctly", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserRepositoryAdapter(db, mkOptions(), auth);

    const dataChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnValue([]), // Resolved data
    };

    const countChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnValue([{ count: 0 }]), // Resolved count
    };

    db.select.mockImplementation((args: { count?: boolean } | undefined) => {
      if (args?.count) {
        return countChain;
      }
      return dataChain;
    });

    await adapter.findAll({ search: "test", limit: 10 });

    expect(dataChain.where).toHaveBeenCalled();

    expect(countChain.where).toHaveBeenCalled();
  });

  it("findAll handles tenant scoping", async () => {
    const db = mkDb();
    const auth = mkAuth();
    const adapter = new DrizzleUserRepositoryAdapter(db, mkOptions(), auth);

    const dataChain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnValue([
        {
          user: mkUser(),
          memberRole: "member-role-id",
        },
      ]),
    };

    const countChain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnValue([{ count: 0 }]),
    };

    db.select.mockImplementation((args: { count?: boolean } | undefined) => {
      if (args?.count) {
        return countChain;
      }
      return dataChain;
    });

    await adapter.findAll({ tenantId: "t1" });
    expect(dataChain.innerJoin).toHaveBeenCalled();
    expect(countChain.innerJoin).toHaveBeenCalled();
    expect(dataChain.where).toHaveBeenCalled();
    expect(countChain.where).toHaveBeenCalled();
  });
});

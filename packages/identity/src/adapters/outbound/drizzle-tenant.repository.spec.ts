/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Tenant as TenantInterface } from "../../core/ports/outbound/index.js";
import type { IIdentityEventPublisher } from "../../core/ports/outbound/index.js";
import { DrizzleTenantRepositoryAdapter } from "./drizzle-tenant.repository.js";
import * as schema from "../../schema.js";

type MockFunc = ReturnType<typeof vi.fn>;

interface MockTx {
  insert: MockFunc;
  values: MockFunc;
  returning: MockFunc;
  delete: MockFunc;
  where: MockFunc;
  update: MockFunc;
  set: MockFunc;
  innerJoin: MockFunc;
  select: MockFunc;
  from: MockFunc;
  limit: MockFunc;
  offset: MockFunc;
  orderBy: MockFunc;
}

interface MockDb {
  transaction: MockFunc;
  insert: MockFunc;
  values: MockFunc;
  returning: MockFunc;
  update: MockFunc;
  set: MockFunc;
  where: MockFunc;
  delete: MockFunc;
  select: MockFunc;
  from: MockFunc;
  limit: MockFunc;
  offset: MockFunc;
  orderBy: MockFunc;
  query: {
    organization: {
      findFirst: MockFunc;
      findMany: MockFunc;
    };
  };
}

describe("DrizzleTenantRepositoryAdapter", () => {
  const now = new Date("2024-01-01T00:00:00.000Z");

  const mkOrg = (
    overrides: Partial<schema.Organization> = {},
  ): schema.Organization => ({
    id: "org-1",
    name: "Acme",
    slug: "acme-1234",
    logo: null,
    status: "active",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    metadata: null,
    isSystem: false,
    ...overrides,
  });

  const mkDb = () => {
    const tx: MockTx = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn(),
      delete: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
    };

    const db = {
      transaction: vi.fn((fn: (tx: MockTx) => unknown) => {
        return fn(tx);
      }),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      query: {
        organization: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
      },
    } as unknown as MockDb;

    db.select.mockReturnValue(db);

    return { db, tx } as const;
  };

  const mkPublisher = (): IIdentityEventPublisher => ({
    publishTenantProvisioned: vi.fn().mockResolvedValue(undefined),
    publishUserInvited: vi.fn().mockResolvedValue(undefined),
  });

  beforeEach(() => {
    vi.setSystemTime(now);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("create creates organization and admin member, handles slug collision retries", async () => {
    const { db, tx } = mkDb();
    const publisher = mkPublisher();
    const adapter = new DrizzleTenantRepositoryAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
      publisher,
    );

    const firstError = new Error("duplicate key") as Error & {
      code: string;
      detail?: string;
    };
    firstError.code = "23505";
    firstError.detail = "Key (slug)=(acme-1234) already exists.";

    db.transaction
      .mockImplementationOnce(() => {
        tx.insert.mockReturnThis();
        tx.values.mockReturnThis();
        tx.returning.mockResolvedValue([mkOrg()]);
        throw firstError;
      })
      .mockImplementationOnce((fn: (tx: MockTx) => unknown) => {
        tx.insert.mockReturnThis();
        tx.values.mockReturnThis();
        tx.returning.mockResolvedValue([mkOrg({ slug: "acme-unique" })]);
        return fn(tx);
      });

    const tenant = await adapter.create("user-1", "Acme");

    expect(tenant.name).toBe("Acme");
    expect(tenant.slug).toMatch(/^acme-/);
    expect(tx.insert).toHaveBeenCalled();
    expect(publisher.publishTenantProvisioned).toHaveBeenCalledTimes(1);
    expect(publisher.publishTenantProvisioned).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: expect.any(String),
        organizationName: tenant.name,
        ownerId: "user-1",
      }),
    );
  });

  it("createTenant inserts organization and maps result; duplicate slug throws", async () => {
    const { db } = mkDb();
    const adapter = new DrizzleTenantRepositoryAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
      mkPublisher(),
    );

    db.returning.mockResolvedValue([mkOrg({ slug: "acme" })]);

    const tenant = await adapter.createTenant({ name: "Acme", slug: "acme" });
    expect(tenant.slug).toBe("acme");

    const dupErr = new Error("duplicate") as Error & { code: string };
    dupErr.code = "23505";
    db.returning.mockRejectedValueOnce(dupErr);

    await expect(
      adapter.createTenant({ name: "Acme", slug: "acme" }),
    ).rejects.toThrow("Tenant with this slug already exists");
  });

  it("createTenant validates empty slug", async () => {
    const { db } = mkDb();
    const adapter = new DrizzleTenantRepositoryAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
      mkPublisher(),
    );

    await expect(
      adapter.createTenant({ name: "Acme", slug: "  " }),
    ).rejects.toThrow("Tenant slug is required");
  });

  it("update trims slug, serializes metadata, handles unique violation", async () => {
    const { db } = mkDb();
    const adapter = new DrizzleTenantRepositoryAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
      mkPublisher(),
    );

    db.returning.mockResolvedValue([
      mkOrg({
        id: "org-2",
        slug: "new-slug",
        metadata: JSON.stringify({ a: 1 }),
      }),
    ]);

    const updated = await adapter.update("org-2", {
      slug: " new-slug ",
      metadata: { a: 1 },
    });
    expect(updated.slug).toBe("new-slug");

    const err = new Error("dup") as Error & { code: string; detail?: string };
    err.code = "23505";
    err.detail = "slug";
    db.returning.mockRejectedValueOnce(err);

    await expect(adapter.update("org-2", { slug: "taken" })).rejects.toThrow(
      "Tenant with this slug already exists",
    );
  });

  it("update rejects empty slug", async () => {
    const { db } = mkDb();
    const adapter = new DrizzleTenantRepositoryAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
      mkPublisher(),
    );

    await expect(adapter.update("org-1", { slug: "  " })).rejects.toThrow(
      "Tenant slug cannot be empty",
    );
  });

  it("delete removes related rows and organization; not found throws", async () => {
    const { db, tx } = mkDb();
    const adapter = new DrizzleTenantRepositoryAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
      mkPublisher(),
    );

    tx.returning.mockResolvedValueOnce([{ id: "org-1" }]);

    await adapter.delete("org-1");

    db.transaction.mockImplementationOnce((fn: (tx: MockTx) => unknown) => {
      // Mock delete returning empty array for second call
      tx.returning.mockResolvedValueOnce([]);
      return fn(tx);
    });

    await expect(adapter.delete("org-404")).rejects.toThrow("Tenant not found");
  });

  it("findAllForUser joins member and organization and maps role", async () => {
    const { db } = mkDb();
    const adapter = new DrizzleTenantRepositoryAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
      mkPublisher(),
    );

    const rows = [
      { org: mkOrg({ id: "org-1", name: "A" }), role: "admin" },
      { org: mkOrg({ id: "org-2", name: "B" }), role: "member" },
    ];

    db.select.mockReturnValueOnce({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve(rows),
        }),
      }),
    });

    const result = await adapter.findAllForUser("user-1");
    expect(result).toHaveLength(2);
    expect(result[0].memberRole).toBe("admin");
  });

  it("findAll supports pagination and search; returns total", async () => {
    const { db } = mkDb();
    const adapter = new DrizzleTenantRepositoryAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
      mkPublisher(),
    );

    const tenants = [mkOrg({ id: "org-1" }), mkOrg({ id: "org-2" })];

    db.select.mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => ({
            offset: () => ({ orderBy: () => Promise.resolve(tenants) }),
          }),
        }),
      }),
    });

    db.select.mockReturnValueOnce({
      from: () => ({ where: () => Promise.resolve([{ count: 2 }]) }),
    });

    const { data, total } = await adapter.findAll({
      page: 1,
      limit: 10,
      search: "acme",
    });
    expect(data).toHaveLength(2);
    expect(total).toBe(2);
  });

  it("findById returns mapped tenant or null", async () => {
    const { db } = mkDb();
    const adapter = new DrizzleTenantRepositoryAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
      mkPublisher(),
    );

    db.query.organization.findFirst.mockResolvedValueOnce(
      mkOrg({ id: "org-1" }),
    );
    const found = await adapter.findById("org-1");
    expect(found?.id).toBe("org-1");

    db.query.organization.findFirst.mockResolvedValueOnce(null);
    const notFound = await adapter.findById("org-x");
    expect(notFound).toBeNull();
  });

  it("findBySlug returns mapped tenant or null", async () => {
    const { db } = mkDb();
    const adapter = new DrizzleTenantRepositoryAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
      mkPublisher(),
    );

    db.query.organization.findFirst.mockResolvedValueOnce(
      mkOrg({ slug: "acme" }),
    );
    const found = await adapter.findBySlug("acme");
    expect(found?.slug).toBe("acme");

    db.query.organization.findFirst.mockResolvedValueOnce(null);
    const notFound = await adapter.findBySlug("missing");
    expect(notFound).toBeNull();
  });

  it("updateStatus updates and returns mapped tenant; not found throws", async () => {
    const { db } = mkDb();
    const adapter = new DrizzleTenantRepositoryAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
      mkPublisher(),
    );

    db.returning.mockResolvedValueOnce([
      mkOrg({ status: "suspended" as TenantInterface["status"] }),
    ]);

    const updated = await adapter.updateStatus(
      "org-1",
      "suspended" as TenantInterface["status"],
    );
    expect(updated.status).toBe("suspended");

    db.returning.mockResolvedValueOnce([]);

    await expect(
      adapter.updateStatus("missing", "active" as TenantInterface["status"]),
    ).rejects.toThrow("Organization with id missing not found");
  });

  it("provisionTenantForUser delegates to create", async () => {
    const { db } = mkDb();
    const adapter = new DrizzleTenantRepositoryAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
      mkPublisher(),
    );

    const spy = vi.spyOn(adapter, "create").mockResolvedValueOnce({
      id: "org-1",
      name: "Organization x",
      slug: "org-x",
      logo: null,
      status: "active",
      createdAt: now,
      metadata: undefined,
    } as TenantInterface);

    const tenant = await adapter.provisionTenantForUser("user-1");
    expect(spy).toHaveBeenCalledWith(
      "user-1",
      expect.any(String), // Fancy name generator produces various names
    );
    expect(tenant.id).toBe("org-1");
  });
});

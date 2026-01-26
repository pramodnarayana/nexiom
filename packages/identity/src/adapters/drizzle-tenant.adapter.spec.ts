/* eslint-disable */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Tenant as TenantInterface } from "../interfaces";
import { DrizzleTenantAdapter } from "./drizzle-tenant.adapter";
import * as schema from "../schema";

type Tx = Record<string, ReturnType<typeof vi.fn>>;

describe("DrizzleTenantAdapter", () => {
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
    ...overrides,
  });

  const mkDb = () => {
    const tx: Record<string, ReturnType<typeof vi.fn>> = {
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

    const db: any = {
      transaction: vi.fn((fn: any) => {
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
        },
      },
    };

    db.select.mockReturnValue(db);

    return { db, tx } as const;
  };

  beforeEach(() => {
    vi.setSystemTime(now);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("create creates organization and admin member, handles slug collision retries", async () => {
    const { db, tx } = mkDb();
    const adapter = new DrizzleTenantAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
    );

    const firstError = new Error("duplicate key") as Error & {
      code: string;
      detail?: string;
    };
    (firstError as any).code = "23505";
    (firstError as any).detail = "Key (slug)=(acme-1234) already exists.";

    db.transaction
      .mockImplementationOnce(() => {
        tx.insert.mockReturnThis();
        tx.values.mockReturnThis();
        (tx.returning as any)!.mockResolvedValue([mkOrg()]);
        return Promise.reject(firstError);
      })
      .mockImplementationOnce((fn: any) => {
        tx.insert.mockReturnThis();
        tx.values.mockReturnThis();
        (tx.returning as any)!.mockResolvedValue([
          mkOrg({ slug: "acme-unique" }),
        ]);
        return fn(tx);
      });

    const tenant = await adapter.create("user-1", "Acme");

    expect(tenant.name).toBe("Acme");
    expect(tenant.slug).toMatch(/^acme-/);
    expect(tx.insert).toHaveBeenCalled();
  });

  it("createTenant inserts organization and maps result; duplicate slug throws", async () => {
    const { db } = mkDb();
    const adapter = new DrizzleTenantAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
    );

    db.returning.mockResolvedValue([mkOrg({ slug: "acme" })]);

    const tenant = await adapter.createTenant({ name: "Acme", slug: "acme" });
    expect(tenant.slug).toBe("acme");

    const dupErr = new Error("duplicate") as Error & { code: string };
    (dupErr as any).code = "23505";
    db.returning.mockRejectedValueOnce(dupErr as unknown as Error);

    await expect(
      adapter.createTenant({ name: "Acme", slug: "acme" }),
    ).rejects.toThrow("Tenant with this slug already exists");
  });

  it("createTenant validates empty slug", async () => {
    const { db } = mkDb();
    const adapter = new DrizzleTenantAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
    );

    await expect(
      adapter.createTenant({ name: "Acme", slug: "  " }),
    ).rejects.toThrow("Tenant slug is required");
  });

  it("update trims slug, serializes metadata, handles unique violation", async () => {
    const { db } = mkDb();
    const adapter = new DrizzleTenantAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
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
    (err as any).code = "23505";
    (err as any).detail = "slug";
    db.returning.mockRejectedValueOnce(err as unknown as Error);

    await expect(adapter.update("org-2", { slug: "taken" })).rejects.toThrow(
      "Tenant with this slug already exists",
    );
  });

  it("update rejects empty slug", async () => {
    const { db } = mkDb();
    const adapter = new DrizzleTenantAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
    );

    await expect(adapter.update("org-1", { slug: "  " })).rejects.toThrow(
      "Tenant slug cannot be empty",
    );
  });

  it("delete removes related rows and organization; not found throws", async () => {
    const { db, tx } = mkDb();
    const adapter = new DrizzleTenantAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
    );

    (tx.returning as any)!.mockResolvedValueOnce([{ id: "org-1" }]);

    await expect(adapter.delete("org-1")).resolves.not.toThrow();

    db.transaction.mockImplementationOnce(async (fn: any) => {
      // Mock delete returning empty array for second call
      (tx.returning as any)!.mockResolvedValueOnce([]);
      return fn(tx);
    });

    await expect(adapter.delete("org-404")).rejects.toThrow("Tenant not found");
  });

  it("findAllForUser joins member and organization and maps role", async () => {
    const { db } = mkDb();
    const adapter = new DrizzleTenantAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
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
    const adapter = new DrizzleTenantAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
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
    const adapter = new DrizzleTenantAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
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
    const adapter = new DrizzleTenantAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
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
    const adapter = new DrizzleTenantAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
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
    const adapter = new DrizzleTenantAdapter(
      db as unknown as NodePgDatabase<typeof schema>,
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
      expect.stringMatching(/^Organization /),
    );
    expect(tenant.id).toBe("org-1");
  });
});

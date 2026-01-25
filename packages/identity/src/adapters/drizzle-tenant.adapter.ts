import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, count, ilike, desc, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import {
  ITenantProvider,
  Tenant as TenantInterface,
  UpdateTenantInput,
} from "../interfaces";
import * as schema from "../schema";

export class DrizzleTenantAdapter implements ITenantProvider {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async create(userId: string, name: string): Promise<TenantInterface> {
    const orgId = uuidv4();
    let slug = this.generateSlug(name);
    let retries = 3;

    while (retries > 0) {
      try {
        return await this.db.transaction(async (tx) => {
          // 1. Create Organization
          const [org] = await tx
            .insert(schema.organization)
            .values({
              id: orgId,
              name: name,
              slug: slug,
              createdAt: new Date(),
              status: "active",
            })
            .returning();

          // 2. Add Member (Admin)
          await tx.insert(schema.member).values({
            id: uuidv4(),
            organizationId: orgId,
            userId: userId,
            role: "admin",
            createdAt: new Date(),
          });

          return this.mapTenant(org);
        });
      } catch (error: any) {
        // Check for unique constraint violation on slug
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        if (error.code === "23505" && error.detail?.includes("slug")) {
          retries--;
          slug = this.generateSlug(name); // Regenerate with new random suffix
          continue;
        }
        throw error;
      }
    }
    throw new Error("Failed to generate unique slug for tenant");
  }

  async createTenant(input: {
    name: string;
    slug: string;
    logo?: string | null;
  }): Promise<TenantInterface> {
    try {
      const [org] = await this.db
        .insert(schema.organization)
        .values({
          id: uuidv4(),
          name: input.name,
          slug: input.slug,
          logo: input.logo,
          createdAt: new Date(),
          status: "active",
        })
        .returning();
      return this.mapTenant(org);
    } catch (error: any) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      if (error.code === "23505" && error.detail?.includes("slug")) {
        throw new Error("Tenant slug already exists");
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateTenantInput): Promise<TenantInterface> {
    const updatePayload: Partial<typeof schema.organization.$inferInsert> = {};
    if (input.name !== undefined) updatePayload.name = input.name;
    if (input.slug !== undefined) updatePayload.slug = input.slug;
    if (input.logo !== undefined) updatePayload.logo = input.logo;
    if (input.status !== undefined) updatePayload.status = input.status;
    if (input.metadata !== undefined)
      updatePayload.metadata = JSON.stringify(input.metadata);

    try {
      const [updated] = await this.db
        .update(schema.organization)
        .set({ ...updatePayload, updatedAt: new Date() })
        .where(eq(schema.organization.id, id))
        .returning();

      if (!updated) throw new Error("Tenant not found");
      return this.mapTenant(updated);
    } catch (error: any) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      if (error.code === "23505" && error.detail?.includes("slug")) {
        throw new Error("Tenant slug already exists");
      }
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      // 1. Check existence first
      const [existing] = await tx
        .select({ id: schema.organization.id })
        .from(schema.organization)
        .where(eq(schema.organization.id, id));

      if (!existing) {
        throw new Error("Tenant not found");
      }

      // 2. Proceed with deletes
      await tx
        .delete(schema.member)
        .where(eq(schema.member.organizationId, id));
      await tx
        .delete(schema.invitation)
        .where(eq(schema.invitation.organizationId, id));
      await tx
        .delete(schema.organization)
        .where(eq(schema.organization.id, id));
    });
  }

  // ...

  private generateSlug(name: string): string {
    return (
      name
        .toLowerCase()
        .replaceAll(/\s+/g, "-")
        .replaceAll(/[^a-z0-9-]/g, "") +
      "-" +
      uuidv4().split("-")[0] // Use first 8 chars of UUID for better uniqueness
    );
  }

  async findAllForUser(
    userId: string,
  ): Promise<(TenantInterface & { memberRole?: string })[]> {
    const rows = await this.db
      .select({
        org: schema.organization,
        role: schema.member.role,
      })
      .from(schema.organization)
      .innerJoin(
        schema.member,
        eq(schema.member.organizationId, schema.organization.id),
      )
      .where(eq(schema.member.userId, userId));

    return rows.map((r) => ({
      ...this.mapTenant(r.org),
      memberRole: r.role,
    }));
  }

  async findAll(options?: {
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<{ data: TenantInterface[]; total: number }> {
    const page = Math.max(1, Number(options?.page) || 1);
    const limit = Math.max(1, Number(options?.limit) || 10);
    const offset = (page - 1) * limit;

    const filters = [];
    if (options?.search) {
      filters.push(ilike(schema.organization.name, `%${options.search}%`));
    }

    const data = await this.db
      .select()
      .from(schema.organization)
      .where(filters.length ? and(...filters) : undefined)
      .limit(limit)
      .offset(offset)
      .orderBy(desc(schema.organization.createdAt));

    const [countResult] = await this.db
      .select({ count: count(schema.organization.id) })
      .from(schema.organization)
      .where(filters.length ? and(...filters) : undefined);

    return {
      data: data.map((d) => this.mapTenant(d)),
      total: Number(countResult?.count || 0),
    };
  }

  async findById(id: string): Promise<TenantInterface | null> {
    const org = await this.db.query.organization.findFirst({
      where: eq(schema.organization.id, id),
    });
    return org ? this.mapTenant(org) : null;
  }

  async findBySlug(slug: string): Promise<TenantInterface | null> {
    const org = await this.db.query.organization.findFirst({
      where: eq(schema.organization.slug, slug),
    });
    return org ? this.mapTenant(org) : null;
  }

  async updateStatus(
    id: string,
    status: TenantInterface["status"],
  ): Promise<TenantInterface> {
    const [org] = await this.db
      .update(schema.organization)
      .set({ status })
      .where(eq(schema.organization.id, id))
      .returning();

    if (!org) {
      throw new Error(`Organization with id ${id} not found`);
    }
    return this.mapTenant(org);
  }

  async provisionTenantForUser(userId: string): Promise<TenantInterface> {
    // 1. Fetch User to get name (optional optimization)
    // For now, generate generic name
    const randomSuffix = Math.random().toString(36).substring(7);
    const companyName = `Organization ${randomSuffix}`;

    return this.create(userId, companyName);
  }

  private mapTenant(dbOrg: schema.Organization): TenantInterface {
    return {
      id: dbOrg.id,
      name: dbOrg.name,
      slug: dbOrg.slug || dbOrg.id, // Fallback
      logo: dbOrg.logo,
      status: dbOrg.status,
      createdAt: dbOrg.createdAt,
      metadata: (() => {
        if (!dbOrg.metadata) return undefined;
        try {
          return JSON.parse(dbOrg.metadata) as Record<string, any>;
        } catch {
          return undefined;
        }
      })(),
    };
  }
}

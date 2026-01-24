import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { ITenantProvider, Tenant as TenantInterface } from "../interfaces";
import * as schema from "../schema";

export class DrizzleTenantAdapter implements ITenantProvider {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async create(userId: string, name: string): Promise<TenantInterface> {
    const orgId = uuidv4();
    const slug = this.generateSlug(name);

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

  async findById(id: string): Promise<TenantInterface | null> {
    const org = await this.db.query.organization.findFirst({
      where: eq(schema.organization.id, id),
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

  private generateSlug(name: string): string {
    return (
      name
        .toLowerCase()
        .replaceAll(/\s+/g, "-")
        .replaceAll(/[^a-z0-9-]/g, "") +
      "-" +
      uuidv4().slice(0, 4)
    );
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

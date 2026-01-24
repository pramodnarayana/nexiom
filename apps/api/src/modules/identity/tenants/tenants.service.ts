import { Injectable, Inject } from '@nestjs/common';
import { DRIZZLE_DB } from '../../../db/db.provider';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

@Injectable()
export class TenantsService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findAllForUser(userId: string) {
    const query = this.db
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
        slug: schema.organization.slug,
        logo: schema.organization.logo,
        createdAt: schema.organization.createdAt,
        metadata: schema.organization.metadata,
        status: schema.organization.status,
        memberRole: schema.member.role, // Optional: Return their role in that org
      })
      .from(schema.organization)
      .innerJoin(
        schema.member,
        eq(schema.member.organizationId, schema.organization.id),
      )
      .where(eq(schema.member.userId, userId));

    return query.execute();
  }

  async updateStatus(id: string, status: 'active' | 'disabled' | 'suspended') {
    const result = await this.db
      .update(schema.organization)
      .set({ status })
      .where(eq(schema.organization.id, id))
      .returning();

    if (!result[0]) {
      throw new Error(`Organization with id ${id} not found`);
    }
    return result[0];
  }

  /**
   * Domain Logic: Create a new Tenant (Organization) and assign the Creator as Admin.
   */
  async createTenant(userId: string, name: string) {
    const orgId = randomUUID();
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
          status: 'active',
        })
        .returning();

      // 2. Add Member (Admin)
      await tx.insert(schema.member).values({
        id: randomUUID(),
        organizationId: orgId,
        userId: userId,
        role: 'admin',
        createdAt: new Date(),
      });

      return org;
    });
  }

  /**
   * Orchestration Logic: Auto-provision a tenant for a given User ID.
   * Derives company name from user metadata if possible, or generates a default.
   */
  async provisionTenantForUser(
    userId: string,
  ): Promise<typeof schema.organization.$inferSelect> {
    // 1. Fetch User to get name/email for auto-naming (optional, but good UX)
    const user = await this.db.query.user.findFirst({
      where: eq(schema.user.id, userId),
    });

    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }

    // 2. Generate Company Name
    // Logic: Try Company Name field? user doesn't have it standard.
    // Use fallback: "Organization <Random>"
    const randomSuffix = Math.random().toString(36).substring(7);
    const companyName = `Organization ${randomSuffix}`;

    // 3. Create
    return this.createTenant(userId, companyName);
  }

  private generateSlug(name: string): string {
    return (
      name
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '') +
      '-' +
      randomUUID().slice(0, 4)
    );
  }
}

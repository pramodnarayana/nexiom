import { Inject, Injectable } from "@nestjs/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  IDENTITY_DB,
  IDENTITY_EVENT_PUBLISHER,
  Role,
} from "../../constants.js";
import { eq, count, ilike, desc, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type {
  ITenantRepository,
  Tenant as TenantInterface,
  UpdateTenantInput,
  IIdentityEventPublisher,
} from "../../core/ports/outbound/index.js";
import { TenantProvisionedEvent } from "../../events/index.js";
import * as schema from "../../schema.js";
import { generateFancyTenantName } from "../../utils/name-generator.js";

interface PgError extends Error {
  code: string;
  detail?: string;
}

@Injectable()
export class DrizzleTenantRepositoryAdapter implements ITenantRepository {
  constructor(
    @Inject(IDENTITY_DB) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(IDENTITY_EVENT_PUBLISHER)
    private readonly eventPublisher: IIdentityEventPublisher,
  ) {}

  async create(userId: string, name: string): Promise<TenantInterface> {
    const orgId = uuidv4();
    let slug = this.generateSlug(name);
    let retries = 3;

    while (retries > 0) {
      try {
        const tenant = await this.db.transaction(async (tx) => {
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
            role: Role.Owner,
            createdAt: new Date(),
          });

          return this.mapTenant(org);
        });

        // Publish the event after the transaction commits successfully
        try {
          await this.eventPublisher.publishTenantProvisioned(
            new TenantProvisionedEvent(orgId, userId, name),
          );
        } catch (err) {
          console.error("Failed to publish TenantProvisionedEvent", err);
        }

        return tenant;
      } catch (error: unknown) {
        // Check for unique constraint violation on slug
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error as PgError).code === "23505" &&
          "detail" in error &&
          (error as PgError).detail?.includes("slug")
        ) {
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
    const slug = input.slug.trim();
    if (!slug) {
      throw new Error("Tenant slug is required");
    }

    try {
      const [org] = await this.db
        .insert(schema.organization)
        .values({
          id: uuidv4(),
          name: input.name,
          slug,
          logo: input.logo,
          createdAt: new Date(),
          status: "active",
        })
        .returning();

      return this.mapTenant(org);
    } catch (error: unknown) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as PgError).code === "23505"
      ) {
        throw new Error("Tenant with this slug already exists");
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateTenantInput): Promise<TenantInterface> {
    // Validate slug if provided
    if (input.slug !== undefined) {
      const trimmedSlug = input.slug.trim();
      if (!trimmedSlug) {
        throw new Error("Tenant slug cannot be empty");
      }
      input = { ...input, slug: trimmedSlug };
    }

    const { metadata, ...rest } = input;

    try {
      const [updated] = await this.db
        .update(schema.organization)
        .set({
          ...rest,
          ...(metadata ? { metadata: JSON.stringify(metadata) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.organization.id, id))
        .returning();

      if (!updated) {
        throw new Error("Tenant not found");
      }

      return this.mapTenant(updated);
    } catch (error: unknown) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as PgError).code === "23505" &&
        "detail" in error &&
        (error as PgError).detail?.includes("slug")
      ) {
        throw new Error("Tenant with this slug already exists");
      }
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.member)
        .where(eq(schema.member.organizationId, id));
      await tx
        .delete(schema.invitation)
        .where(eq(schema.invitation.organizationId, id));
      const [deleted] = await tx
        .delete(schema.organization)
        .where(eq(schema.organization.id, id))
        .returning({ id: schema.organization.id });

      if (!deleted) {
        throw new Error("Tenant not found");
      }
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

  async findOneForUser(
    userId: string,
    tenantId?: string,
  ): Promise<(TenantInterface & { memberRole?: string }) | null> {
    const conditions = [eq(schema.member.userId, userId)];
    if (tenantId) {
      conditions.push(eq(schema.organization.id, tenantId));
    }

    const [row] = await this.db
      .select({
        org: schema.organization,
        role: schema.member.role,
      })
      .from(schema.organization)
      .innerJoin(
        schema.member,
        eq(schema.member.organizationId, schema.organization.id),
      )
      .where(and(...conditions))
      .orderBy(
        desc(schema.organization.createdAt),
        desc(schema.organization.id),
      )
      .limit(1);

    if (!row) return null;

    return {
      ...this.mapTenant(row.org),
      memberRole: row.role,
    };
  }

  async findAll(options?: {
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<{ data: TenantInterface[]; total: number }> {
    const page = Math.max(1, Math.floor(Number(options?.page) || 1));
    const limit = Math.max(1, Math.floor(Number(options?.limit) || 10));
    const offset = (page - 1) * limit;

    const filters = [];
    if (options?.search) {
      filters.push(ilike(schema.organization.name, `%${options.search}%`));
    }

    const dataQuery = this.db
      .select()
      .from(schema.organization)
      .where(filters.length ? and(...filters) : undefined)
      .limit(limit)
      .offset(offset)
      .orderBy(
        desc(schema.organization.createdAt),
        desc(schema.organization.id),
      );

    const [countResult] = await this.db
      .select({ count: count(schema.organization.id) })
      .from(schema.organization)
      .where(filters.length ? and(...filters) : undefined);

    const tenants = await dataQuery;

    return {
      data: tenants.map((t) => this.mapTenant(t)),
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
    // Use Fancy Name Generator for better user experience
    const companyName = generateFancyTenantName();

    return this.create(userId, companyName);
  }

  async findPendingInvitation(email: string): Promise<boolean> {
    const normalizedEmail = email.toLowerCase().trim();
    const invite = await this.db.query.invitation.findFirst({
      where: (t, { eq, and, gt }) =>
        and(
          eq(t.email, normalizedEmail),
          eq(t.status, "pending"),
          gt(t.expiresAt, new Date()),
        ),
    });
    return !!invite;
  }

  private mapTenant(dbOrg: schema.Organization): TenantInterface {
    return {
      id: dbOrg.id,
      name: dbOrg.name,
      slug: dbOrg.slug || dbOrg.id, // Fallback
      logo: dbOrg.logo,
      status: dbOrg.status,
      createdAt: dbOrg.createdAt,
      updatedAt: dbOrg.updatedAt,
      metadata: (() => {
        if (!dbOrg.metadata) return undefined;
        try {
          return JSON.parse(dbOrg.metadata) as Record<string, any>;
        } catch {
          return undefined;
        }
      })(),
      isSystem: dbOrg.isSystem,
    };
  }
}

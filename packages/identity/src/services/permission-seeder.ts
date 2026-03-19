import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema.js";
import { IDENTITY_OPTIONS, IDENTITY_DB } from "../constants.js";
import type { IdentityModuleOptions } from "../identity.module.js";
import { seedSystemRbac } from "../utils/rbac-seeding.js";

@Injectable()
export class PermissionSeeder implements OnModuleInit {
  private readonly logger = new Logger(PermissionSeeder.name);

  constructor(
    @Inject(IDENTITY_DB) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityModuleOptions,
  ) {}

  async onModuleInit() {
    // Always run seedSystemRbac — it is fully idempotent (read-filter-insert),
    // so it safely picks up any new permissions added to ALL_PERMISSIONS without
    // touching rows that already exist.
    try {
      await this.seed();
    } catch (error) {
      this.logger.error("Failed to seed RBAC data", error);
      throw error;
    }
  }

  async seed() {
    this.logger.log("Seeding RBAC data...");

    const { ownerRoleId, adminRoleId, memberRoleId, systemTenantId } =
      this.options.constants;

    await this.db.transaction(async (tx) => {
      // Ensure System Tenant exists to avoid FK violations
      const systemTenant = await tx.query.organization.findFirst({
        where: (org, { eq }) => eq(org.id, systemTenantId),
      });

      if (!systemTenant) {
        this.logger.log(`Creating System Tenant (${systemTenantId})...`);
        await tx
          .insert(schema.organization)
          .values({
            id: systemTenantId,
            name: "Nexiom Platform",
            slug: "system",
            isSystem: true,
            status: "active",
          })
          .onConflictDoNothing();
      }

      await seedSystemRbac(
        tx,
        { ownerRoleId, adminRoleId, memberRoleId, systemTenantId },
        this.logger,
      );
    });
  }
}

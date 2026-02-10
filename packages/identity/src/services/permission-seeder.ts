import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema";
import { IDENTITY_OPTIONS, IDENTITY_DB } from "../constants";
import type { IdentityModuleOptions } from "../identity.module";
import { seedSystemRbac } from "../utils/rbac-seeding";

@Injectable()
export class PermissionSeeder implements OnModuleInit {
  private readonly logger = new Logger(PermissionSeeder.name);

  constructor(
    @Inject(IDENTITY_DB) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityModuleOptions,
  ) {}

  async onModuleInit() {
    // Only seed if RBAC data is missing (performance optimization)
    // Check for existence of any role assignments to ensure complete seeding
    try {
      const existingAssignments = await this.db.query.rolePermission.findMany({
        limit: 1,
      });
      if (existingAssignments.length === 0) {
        await this.seed();
      } else {
        this.logger.log("RBAC data already exists, skipping seed");
      }
    } catch (error) {
      this.logger.error("Failed to check existing RBAC data", error);
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

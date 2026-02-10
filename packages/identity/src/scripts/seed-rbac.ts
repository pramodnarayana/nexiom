import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema";
import {
  getOwnerRoleId,
  getAdminRoleId,
  getMemberRoleId,
  getSystemTenantId,
} from "../constants";
import { seedSystemRbac } from "../utils/rbac-seeding";
import { Logger } from "@nestjs/common";

export const seedRbac = async (db: NodePgDatabase<typeof schema>) => {
  const logger = new Logger("SeedRbacScript");
  logger.log("Seeding RBAC...");

  // 1. Cache configuration values
  const ownerRoleId = getOwnerRoleId();
  const adminRoleId = getAdminRoleId();
  const memberRoleId = getMemberRoleId();
  const systemTenantId = getSystemTenantId();

  // 2. Validate all required constants
  if (!ownerRoleId || !adminRoleId || !memberRoleId) {
    logger.error(
      "Missing required RBAC Role IDs (OWNER_ROLE_ID, ADMIN_ROLE_ID, MEMBER_ROLE_ID)",
    );
    throw new Error(
      "Missing required RBAC Role IDs (OWNER_ROLE_ID, ADMIN_ROLE_ID, MEMBER_ROLE_ID)",
    );
  }

  if (!systemTenantId) {
    logger.error("Missing required System Tenant ID (SYSTEM_TENANT_ID)");
    throw new Error("Missing required System Tenant ID (SYSTEM_TENANT_ID)");
  }

  // 3. Build config with validated values
  const config = {
    ownerRoleId,
    adminRoleId,
    memberRoleId,
    systemTenantId,
  };

  await seedSystemRbac(db, config, logger);

  logger.log("RBAC Seeding Complete.");
};

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
  console.log("Seeding RBAC...");

  if (!getOwnerRoleId() || !getAdminRoleId() || !getMemberRoleId()) {
    throw new Error(
      "Missing required RBAC Role IDs (OWNER_ROLE_ID, ADMIN_ROLE_ID, MEMBER_ROLE_ID)",
    );
  }

  // Note: seed-rbac.ts typically runs in contexts where SYSTEM_TENANT_ID might not be strictly required
  // if not scoping. But canonical seeder requires it.
  const systemTenantId = getSystemTenantId();

  const config = {
    ownerRoleId: getOwnerRoleId(),
    adminRoleId: getAdminRoleId(),
    memberRoleId: getMemberRoleId(),
    systemTenantId,
  };

  const logger = new Logger("SeedRbacScript");
  await seedSystemRbac(db, config, logger);

  console.log("RBAC Seeding Complete.");
};

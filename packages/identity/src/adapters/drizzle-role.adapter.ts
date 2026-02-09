import { Injectable, Inject } from "@nestjs/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, desc } from "drizzle-orm";
import * as schema from "../schema";
import { IDENTITY_DB } from "../constants";
import {
  IRoleProvider,
  Role,
  FindRolesOptions,
} from "../interfaces/role-provider.interface";

@Injectable()
export class DrizzleRoleAdapter implements IRoleProvider {
  constructor(
    @Inject(IDENTITY_DB) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findAll(options?: FindRolesOptions): Promise<Role[]> {
    const roles = await this.db.query.role.findMany({
      where: (role, { eq }) => {
        if (options?.scope === "system") {
          // System Admin context: return system roles + global roles that make sense (like 'user' on platform level)
          // Actually, 'isSystem' flag distinguishes.
          // If scope is system, we might want ALL roles or just system roles?
          // The requirement is:
          // System Admin -> ['admin', 'user'] (Platform Admin, Platform User)
          // Tenant Admin -> ['admin', 'member', 'viewer'] (Tenant Roles)

          // In our schema, `isSystem` boolean exists.
          // If scope is system, we return roles where isSystem = true (plus maybe 'user' if it's dual purpose?)
          // Let's rely on `isSystem` flag.
          return eq(role.isSystem, true);
        } else if (options?.scope === "organization") {
          // Organization context: return roles where isSystem = false
          return eq(role.isSystem, false);
        }
        return undefined; // Return all if no scope
      },
      orderBy: [desc(schema.role.createdAt)],
    });

    return roles;
  }

  async findById(id: string): Promise<Role | null> {
    const role = await this.db.query.role.findFirst({
      where: eq(schema.role.id, id),
    });
    return role || null;
  }
}

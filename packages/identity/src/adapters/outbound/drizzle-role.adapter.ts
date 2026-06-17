import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, desc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import * as schema from "../../schema.js";
import { IDENTITY_DB } from "../../constants.js";
import type {
  RoleRepositoryPort,
  RoleEntity,
  FindRolesOptions,
  CreateRoleInput,
  UpdateRoleInput,
} from "../../core/ports/outbound/index.js";

@Injectable()
export class DrizzleRoleRepositoryAdapter implements RoleRepositoryPort {
  constructor(
    @Inject(IDENTITY_DB) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Finds all roles, optionally filtering by scope.
   * - system -> isSystem = true
   * - organization -> isSystem = false
   * - undefined -> return all
   */
  async findAll(options?: FindRolesOptions): Promise<RoleEntity[]> {
    const roles = await this.db.query.role.findMany({
      where: (role, { eq }) => {
        if (options?.scope === "system") {
          return eq(role.isSystem, true);
        } else if (options?.scope === "organization") {
          return eq(role.isSystem, false);
        }
        return undefined;
      },
      orderBy: [desc(schema.role.createdAt)],
    });

    return roles;
  }

  async findById(id: string): Promise<RoleEntity | null> {
    const role = await this.db.query.role.findFirst({
      where: eq(schema.role.id, id),
    });
    return role || null;
  }

  async create(input: CreateRoleInput): Promise<RoleEntity> {
    const [role] = await this.db
      .insert(schema.role)
      .values({
        id: uuidv4(),
        name: input.name,
        description: input.description,
        isSystem: input.isSystem ?? false,
      })
      .returning();
    return role;
  }

  async update(id: string, input: UpdateRoleInput): Promise<RoleEntity> {
    const [role] = await this.db
      .update(schema.role)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
      })
      .where(eq(schema.role.id, id))
      .returning();

    if (!role) throw new NotFoundException("Role not found");
    return role;
  }

  async delete(id: string): Promise<void> {
    const [deleted] = await this.db
      .delete(schema.role)
      .where(eq(schema.role.id, id))
      .returning();

    if (!deleted) throw new NotFoundException("Role not found");
  }
}

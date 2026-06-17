import { Inject, Injectable, Logger } from "@nestjs/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, and, ilike, count, desc } from "drizzle-orm";
import {
  UserRepositoryPort,
  UpdateUserInput,
  User as UserInterface,
  IAuthProvider,
  UserNotFoundError,
  TenantNotFoundError,
} from "../../core/ports/outbound/index.js";
import type { CreateUserInput } from "../../core/ports/outbound/index.js";
import * as schema from "../../schema.js";
import {
  AUTH_PROVIDER,
  IDENTITY_OPTIONS,
  IDENTITY_DB,
} from "../../constants.js";
import type { IdentityModuleOptions } from "../../identity.module.js";

@Injectable()
export class DrizzleUserRepositoryAdapter implements UserRepositoryPort {
  private readonly logger = new Logger(DrizzleUserRepositoryAdapter.name);

  constructor(
    @Inject(IDENTITY_DB) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityModuleOptions,
    @Inject(AUTH_PROVIDER) private readonly authProvider: IAuthProvider,
  ) {}

  async create(input: CreateUserInput): Promise<UserInterface> {
    // Delegate to AuthProvider to handle account creation (and password hashing)
    const user = await this.authProvider.createUser(input);

    return user;
  }
  async update(id: string, input: UpdateUserInput): Promise<UserInterface> {
    // If password is being updated, handle it via AuthProvider
    if (input.password) {
      if (!this.authProvider.setPassword) {
        throw new Error(
          "Password updates are not supported by this auth provider",
        );
      }
      await this.authProvider.setPassword(id, input.password);
    }

    // Update user fields
    if (Object.keys(input).length > 0) {
      const { password: _, ...updates } = input; // Exclude password from User table update

      if (Object.keys(updates).length > 0) {
        await this.db
          .update(schema.user)
          .set({
            ...updates,
            updatedAt: new Date(),
          })
          .where(eq(schema.user.id, id));
      }
    }

    const updated = await this.db.query.user.findFirst({
      where: eq(schema.user.id, id),
    });

    if (!updated) throw new Error("User not found after update");

    return this.mapUser(updated);
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Manually delete tables restricting deletion (Member, Invitation)
      await tx.delete(schema.member).where(eq(schema.member.userId, id));
      await tx
        .delete(schema.invitation)
        .where(eq(schema.invitation.inviterId, id));

      // Cascade other tables (redundant if schema handles it, but safe)
      await tx.delete(schema.session).where(eq(schema.session.userId, id));
      await tx.delete(schema.account).where(eq(schema.account.userId, id));
      await tx.delete(schema.user).where(eq(schema.user.id, id));
    });
  }

  async findById(id: string): Promise<UserInterface | null> {
    // Delegate to AuthProvider to ensure consistent permission mapping logic
    try {
      if (this.authProvider.findById) {
        return await this.authProvider.findById(id);
      }

      // Fallback to local DB if AuthProvider doesn't support findById
      const user = await this.db.query.user.findFirst({
        where: eq(schema.user.id, id),
      });
      return user ? this.mapUser(user) : null;
    } catch (error) {
      // Only return null for "not found" errors from authProvider
      // All other errors (connection, query syntax, etc.) should propagate

      if (error instanceof UserNotFoundError) {
        return null;
      }

      // Check for provider-specific "not found" error properties if available
      // Using strict regex matching to avoid swallowing unrelated errors
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Match user/entity not-found errors while avoiding infrastructure errors
      // Accepts: "User not found", "Entity not found", "Record not found", "Not found"
      // Rejects: "User session not found", "User token not found", "connection not found"
      // Only allow whitespace between entity type and "not found"
      const isUserNotFoundError =
        /\b(user|entity|record)\s+not\s+found\b/i.test(errorMessage) ||
        /^not found$/i.test(errorMessage);
      if (isUserNotFoundError) {
        return null;
      }

      // Log and rethrow unexpected errors
      // NestJS Logger.error(message, stack, context)
      this.logger.error(
        `findById failed for user ${id}: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
        "DrizzleUserRepositoryAdapter.findById",
      );
      throw error;
    }
  }

  async findByEmail(email: string): Promise<UserInterface | null> {
    const user = await this.db.query.user.findFirst({
      where: eq(schema.user.email, email),
    });
    return user ? this.mapUser(user) : null;
  }

  async findAll(options?: {
    page?: number;
    limit?: number;
    search?: string;
    tenantId?: string;
  }): Promise<{ data: UserInterface[]; total: number }> {
    const page = Math.max(1, Math.floor(Number(options?.page) || 1));
    const MAX_LIMIT = 100;
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Math.floor(Number(options?.limit) || 10)),
    );
    const offset = (page - 1) * limit;

    const filters = this.buildUserFilters(options);

    if (options?.tenantId) {
      // Tenant-scoped (requires Join)
      const dataQuery = this.db
        .select({
          user: schema.user,
          memberRole: schema.member.role,
        })
        .from(schema.user)
        .innerJoin(schema.member, eq(schema.member.userId, schema.user.id))
        .where(
          and(
            eq(schema.member.organizationId, options.tenantId),
            ...(filters.length ? filters : []),
          ),
        )
        .limit(limit)
        .offset(offset)
        .orderBy(desc(schema.user.createdAt));

      const [countResult] = await this.db
        .select({ count: count(schema.user.id) })
        .from(schema.user)
        .innerJoin(schema.member, eq(schema.member.userId, schema.user.id))
        .where(
          and(
            eq(schema.member.organizationId, options.tenantId),
            ...(filters.length ? filters : []),
          ),
        );

      const users = await dataQuery;
      return {
        data: users.map((u) => ({
          ...this.mapUser(u.user),
          memberRole: u.memberRole, // Pass the joined role ID
        })),
        total: Number(countResult?.count || 0),
      };
    } else {
      // Global list (Admin)
      const dataQuery = this.db
        .select()
        .from(schema.user)
        .where(filters.length ? and(...filters) : undefined)
        .limit(limit)
        .offset(offset)
        .orderBy(desc(schema.user.createdAt));

      const [countResult] = await this.db
        .select({ count: count(schema.user.id) })
        .from(schema.user)
        .where(filters.length ? and(...filters) : undefined);

      const users = await dataQuery;
      return {
        data: users.map((u) => this.mapUser(u)),
        total: Number(countResult?.count || 0),
      };
    }
  }

  async count(filters?: {
    tenantId?: string;
    search?: string;
  }): Promise<number> {
    const whereConditions = this.buildUserFilters(filters);

    if (filters?.tenantId) {
      const [result] = await this.db
        .select({ count: count(schema.user.id) })
        .from(schema.user)
        .innerJoin(schema.member, eq(schema.member.userId, schema.user.id))
        .where(whereConditions.length ? and(...whereConditions) : undefined);
      return Number(result?.count || 0);
    }

    const [result] = await this.db
      .select({ count: count(schema.user.id) })
      .from(schema.user)
      .where(whereConditions.length ? and(...whereConditions) : undefined);

    return Number(result?.count || 0);
  }

  private buildUserFilters(filters?: { tenantId?: string; search?: string }) {
    const whereConditions = [];

    if (filters?.search) {
      whereConditions.push(ilike(schema.user.email, `%${filters.search}%`));
    }

    if (filters?.tenantId) {
      whereConditions.push(eq(schema.member.organizationId, filters.tenantId));
    }

    return whereConditions;
  }

  async forceVerifyEmail(userId: string): Promise<void> {
    await this.db
      .update(schema.user)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(eq(schema.user.id, userId));
  }
  /**
   * Atomically remove a user's membership from an organization, ensuring the user is not the last admin.
   * This does NOT delete the user account itself, only the membership record.
   * This operation is performed in a single transaction to prevent TOCTOU race conditions.
   */
  async deleteIfNotLastAdmin(
    userId: string,
    tenantId: string,
  ): Promise<{ success: boolean; hardDeleted?: boolean }> {
    // Validate configuration before entering transaction
    if (!this.options.constants?.adminRoleId) {
      throw new Error(
        "IdentityModuleOptions.constants.adminRoleId is undefined",
      );
    }

    return await this.db.transaction(async (tx) => {
      // 0. Acquire lock on organization row to prevent write-skew (concurrent admin deletions)
      const orgLock = await tx
        .select({ id: schema.organization.id })
        .from(schema.organization)
        .where(eq(schema.organization.id, tenantId))
        .for("update");

      if (!orgLock.length) {
        throw new TenantNotFoundError("Organization not found");
      }

      // 1. Verify user exists and is a member of the tenant, and get their role
      const membershipWithRole = await tx
        .select({
          memberId: schema.member.id,
          roleId: schema.role.id,
        })
        .from(schema.member)
        .innerJoin(schema.role, eq(schema.member.role, schema.role.id))
        .where(
          and(
            eq(schema.member.userId, userId),
            eq(schema.member.organizationId, tenantId),
          ),
        )
        .limit(1);

      if (!membershipWithRole.length) {
        throw new UserNotFoundError(
          "User is not a member of this organization",
        );
      }

      const userRole = membershipWithRole[0].roleId;

      // 2. If user is an admin, count total admins
      if (userRole === this.options.constants.adminRoleId) {
        // Count admins by joining member with role table
        const adminCountResult = await tx
          .select({ count: count(schema.member.id) })
          .from(schema.member)
          .innerJoin(schema.role, eq(schema.member.role, schema.role.id))
          .where(
            and(
              eq(schema.member.organizationId, tenantId),
              eq(schema.role.id, this.options.constants.adminRoleId),
            ),
          );

        const adminCount = Number(adminCountResult[0]?.count || 0);

        // 3. Prevent deletion if last admin
        if (adminCount <= 1) {
          return { success: false }; // Signal that deletion was prevented
        }
      }

      // 4. Delete the user membership (atomic with the check above)
      await tx
        .delete(schema.member)
        .where(
          and(
            eq(schema.member.userId, userId),
            eq(schema.member.organizationId, tenantId),
          ),
        );

      // 5. Check if user has any other memberships
      const remainingMemberships = await tx
        .select({ count: count(schema.member.id) })
        .from(schema.member)
        .where(eq(schema.member.userId, userId));

      const membershipCount = Number(remainingMemberships[0]?.count || 0);
      let hardDeleted = false;

      // 6. If no memberships remain, HARD DELETE the user account (Orphan Cleanup)
      if (membershipCount === 0) {
        // Cascade delete user data (same as delete method)
        await tx
          .delete(schema.invitation)
          .where(eq(schema.invitation.inviterId, userId));
        await tx
          .delete(schema.session)
          .where(eq(schema.session.userId, userId));
        await tx
          .delete(schema.account)
          .where(eq(schema.account.userId, userId));
        await tx.delete(schema.user).where(eq(schema.user.id, userId));

        hardDeleted = true;
      }

      return { success: true, hardDeleted };
    });
  }

  private mapUser(dbUser: schema.User): UserInterface {
    return {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name ?? null,
      emailVerified: dbUser.emailVerified,
      image: dbUser.image || undefined,
      createdAt: dbUser.createdAt,
      updatedAt: dbUser.updatedAt,
      role: dbUser.role,
      banned: dbUser.banned || false,
      banReason: dbUser.banReason || null,
      banExpires: dbUser.banExpires || null,
    };
  }
}

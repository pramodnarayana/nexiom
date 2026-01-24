import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, and, ilike, count, desc } from "drizzle-orm";
import {
  IUserProvider,
  CreateUserInput,
  UpdateUserInput,
  User as UserInterface,
  IAuthProvider,
} from "../interfaces";
import * as schema from "../schema";

export class DrizzleUserAdapter implements IUserProvider {
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly authProvider: IAuthProvider,
  ) {}

  async create(input: CreateUserInput): Promise<UserInterface> {
    // Delegate to AuthProvider to handle account creation (and password hashing)
    return await this.authProvider.createUser(input);
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
    const user = await this.db.query.user.findFirst({
      where: eq(schema.user.id, id),
    });
    return user ? this.mapUser(user) : null;
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
    const page = options?.page || 1;
    const limit = options?.limit || 10;
    const offset = (page - 1) * limit;

    const filters = [];
    if (options?.search) {
      filters.push(
        ilike(schema.user.email, `%${options.search}%`),
        // OR name search if needed, but keeping simple for now
      );
    }

    if (options?.tenantId) {
      // Tenant-scoped (requires Join)
      filters.push(eq(schema.member.organizationId, options.tenantId));

      const dataQuery = this.db
        .select({ user: schema.user })
        .from(schema.user)
        .innerJoin(schema.member, eq(schema.member.userId, schema.user.id))
        .where(and(...filters))
        .limit(limit)
        .offset(offset)
        .orderBy(desc(schema.user.createdAt));

      const [countResult] = await this.db
        .select({ count: count(schema.user.id) })
        .from(schema.user)
        .innerJoin(schema.member, eq(schema.member.userId, schema.user.id))
        .where(and(...filters));

      const users = await dataQuery;
      return {
        data: users.map((u) => this.mapUser(u.user)),
        total: Number(countResult?.count || 0),
      };
    } else {
      // Global list (Admin)
      const dataQuery = this.db
        .select()
        .from(schema.user)
        .where(and(...filters))
        .limit(limit)
        .offset(offset)
        .orderBy(desc(schema.user.createdAt));

      const [countResult] = await this.db
        .select({ count: count(schema.user.id) })
        .from(schema.user)
        .where(and(...filters));

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
    systemRole?: string;
  }): Promise<number> {
    const whereConditions = [];

    if (filters?.search) {
      whereConditions.push(ilike(schema.user.email, `%${filters.search}%`));
    }

    if (filters?.systemRole) {
      whereConditions.push(eq(schema.user.systemRole, filters.systemRole));
    }

    if (filters?.tenantId) {
      whereConditions.push(eq(schema.member.organizationId, filters.tenantId));
      const [result] = await this.db
        .select({ count: count(schema.user.id) })
        .from(schema.user)
        .innerJoin(schema.member, eq(schema.member.userId, schema.user.id))
        .where(and(...whereConditions));
      return Number(result?.count || 0);
    }

    const [result] = await this.db
      .select({ count: count(schema.user.id) })
      .from(schema.user)
      .where(and(...whereConditions));

    return Number(result?.count || 0);
  }

  async forceVerifyEmail(userId: string): Promise<void> {
    await this.db
      .update(schema.user)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(eq(schema.user.id, userId));
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
      systemRole: dbUser.systemRole || null,
      banned: dbUser.banned || false,
      banReason: dbUser.banReason || null,
      banExpires: dbUser.banExpires || null,
    };
  }
}

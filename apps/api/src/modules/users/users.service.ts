import { Injectable, Inject } from '@nestjs/common';
import { CreateUser } from './users.validation';
import { User } from './user.schema';
import { IdentityProvider } from '../auth/identity-provider.abstract';
import { DRIZZLE_DB } from '../../db/db.provider';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';

/**
 * Service responsible for managing Users.
 * Handles database operations and integration with Identity Provider.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly identityProvider: IdentityProvider,
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Creates a new user in the Identity Provider.
   *
   * @param createUser - The validated request object containing user details.
   * @returns The newly created User object from IDP.
   */
  async create(createUser: CreateUser): Promise<User> {
    // 1. Create in IDP (Abstracted)
    const idpUser = await this.identityProvider.createUser(createUser);

    // 2. Return the result (In real app, we would also save to local DB here)
    return idpUser;
  }

  async findAll(tenantId?: string) {
    if (!tenantId) return [];

    // Filter users who are members of the given organization (tenant)
    // Note: returning schema.User[]
    const users = await this.db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        emailVerified: schema.user.emailVerified,
        image: schema.user.image,
        createdAt: schema.user.createdAt,
        updatedAt: schema.user.updatedAt,
        role: schema.member.role,
      })
      .from(schema.user)
      .innerJoin(schema.member, eq(schema.member.userId, schema.user.id))
      .where(eq(schema.member.organizationId, tenantId))
      .execute();

    // Define the shape of the joined result
    type UserWithRole = schema.User & { role: string | null };

    return users as unknown as UserWithRole[];
  }

  findOne(id: string) {
    return { id }; // TODO
  }
}

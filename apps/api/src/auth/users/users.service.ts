import { Injectable } from '@nestjs/common';
import { CreateUser } from './users.schema';
import { User } from '../../schema/better-auth';
import { IdentityProvider } from '../identity-provider.abstract';

/**
 * Service responsible for managing Users.
 * Handles database operations and integration with Identity Provider.
 */
@Injectable()
export class UsersService {
  constructor(private readonly identityProvider: IdentityProvider) {}

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
    return this.identityProvider.listUsers(tenantId);
  }

  findOne(id: string) {
    return { id }; // TODO
  }
}

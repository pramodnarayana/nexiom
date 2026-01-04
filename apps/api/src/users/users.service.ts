import { Injectable } from '@nestjs/common';
import { CreateUser } from './users.schema';
import { User } from './entities/user.entity';
import { IdentityProvider } from '../auth/identity-provider.abstract';

/**
 * Service responsible for managing Users.
 * Handles database operations and integration with Identity Provider.
 */
@Injectable()
export class UsersService {
    constructor(private readonly identityProvider: IdentityProvider) { }

    /**
     * Creates a new user in the Identity Provider (e.g. Zitadel).
     * 
     * @param createUser - The validated data transfer object containing user details.
     * @returns The newly created User object from IDP.
     */
    async create(createUser: CreateUser): Promise<any> {
        // 1. Create in IDP (Abstracted)
        const idpUser = await this.identityProvider.createHumanUser(createUser);

        // 2. Return the result (In real app, we would also save to local DB here)
        return idpUser;
    }

    findAll() {
        return []; // TODO: Fetch from Zitadel or Local DB
    }

    findOne(id: string) {
        return { id }; // TODO
    }
}

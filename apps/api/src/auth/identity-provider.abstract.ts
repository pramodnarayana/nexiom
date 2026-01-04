import { CreateUser } from '../users/users.schema';

/**
 * Abstract Class defining the contract for Identity Providers.
 * This allows swapping Zitadel with Auth0/Keycloak without changing business logic.
 * 
 * We use an abstract class instead of an interface so it can be used 
 * as a Dependency Injection token in NestJS.
 */
export abstract class IdentityProvider {
    /**
     * Creates a user in the external identity system.
     * @param user The user details to create.
     * @returns The created user object from the provider.
     */
    abstract createHumanUser(user: CreateUser): Promise<any>;
}

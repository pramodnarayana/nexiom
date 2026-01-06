import { CreateUser } from './users/users.schema';

/**
 * Abstract Class defining the contract for Identity Providers.
 * This allows swapping Better Auth with Auth0/Keycloak without changing business logic.
 * 
 * We use an abstract class instead of an interface so it can be used 
 * as a Dependency Injection token in NestJS.
 */
import { User, Session } from '../schema/better-auth';

/**
 * Abstract Class defining the contract for Identity Providers.
 * ...
 */
export abstract class IdentityProvider {
    /**
     * Creates a user in the external identity system.
     * @param user The user details to create.
     * @returns The created user object from the provider.
     */
    abstract createUser(user: CreateUser): Promise<User>;

    /**
     * Authenticates a user and returns a session/token.
     * @param email 
     * @param password 
     */
    abstract login(email: string, password?: string): Promise<{ session: Session; user: User }>;

    /**
     * Validates a session ID.
     * @param sessionId 
     */
    abstract validateSession(sessionId: string): Promise<{ session: Session; user: User } | null>;

    /**
     * Lists users from the external identity system.
     * Lists all users in the Identity Provider for a specific tenant.
     */
    abstract listUsers(tenantId?: string): Promise<User[]>;

    /**
     * Retrieves a session and enriches it with extensive application data (e.g. Organization ID, Roles).
     * This is used to guarantee that the session context is complete before processing requests.
     */
    abstract getEnrichedSession(sessionId: string): Promise<{ session: Session; user: User & { hasTenant: boolean; organizationId?: string; organizationName?: string; roles?: string[] } } | null>;
}

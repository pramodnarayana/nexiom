import { CreateUser } from '../users/users.validation';

/**
 * Abstract Class defining the contract for Identity Providers.
 * This allows swapping Better Auth with Auth0/Keycloak without changing business logic.
 *
 * We use an abstract class instead of an interface so it can be used
 * as a Dependency Injection token in NestJS.
 */
import { User } from '../users/user.schema';
import { Session } from './auth.schema';

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
  abstract login(
    email: string,
    password?: string,
  ): Promise<{ session: Session; user: User; cookie?: string | string[] }>;

  /**
   * Validates a session ID.
   * @param sessionId
   */
  abstract validateSession(
    sessionId: string,
  ): Promise<{ session: Session; user: User } | null>;

  /**
   * Validates a session using the raw request headers (delegating to the library).
   * This is preferred over validateSession(token) when dealing with signed cookies.
   */
  abstract getSessionFromHeaders(
    headers: Headers,
  ): Promise<{ session: Session; user: User } | null>;

  /**
   * Retrieves a session and enriches it with extensive application data (e.g. Organization ID, Roles).
   * This is used to guarantee that the session context is complete before processing requests.
   */
  abstract getEnrichedSession(sessionId: string): Promise<{
    session: Session;
    user: User & {
      hasTenant: boolean;
      organizationId?: string;
      organizationName?: string;
      roles?: string[];
    };
  } | null>;

  /**
   * Creates an invitation for a user to join an organization.
   */
  abstract createInvitation(payload: {
    email: string;
    role: string;
    organizationId: string | null;
    expiresIn?: number;
    inviterId: string;
    headers?: Headers;
  }): Promise<unknown>;

  /**
   * Retrieves an invitation by ID.
   */
  abstract getInvitation(id: string): Promise<unknown>;

  /**
   * Accepts an invitation, creating a link between the user and the organization.
   */
  abstract acceptInvitation(
    invitationId: string,
    inviterId: string,
  ): Promise<unknown>;

  /**
   * List pending invitations for an organization
   */
  abstract listInvitations(organizationId: string): Promise<unknown[]>;

  /**
   * Returns the underlying auth handler (e.g. Better Auth handler) for usage in catch-all routes.
   * Returns any because the handler type depends on the implementation library.
   */
  abstract getHandler(): any;

  /**
   * Forcibly marks a user's email as verified.
   * critical for Invite based signups where possession of the link implies verification.
   */
  abstract forceVerifyEmail(userId: string): Promise<void>;

  /**
   * Deletes a user (Used for cleanup/rollback scenarios).
   */
  abstract deleteUser(userId: string): Promise<void>;

  /**
   * Updates a user's profile data.
   */
  abstract updateUser(userId: string, data: Partial<User>): Promise<User>;

  /**
   * Retrieves a user by their email address.
   */
  abstract getUserByEmail(email: string): Promise<User | null>;

  /**
   * Sets the password for a user (admin override / invite completion).
   */
  abstract setPassword(userId: string, password: string): Promise<void>;
}

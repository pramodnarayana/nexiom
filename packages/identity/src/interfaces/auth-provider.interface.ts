import type { AuthResult, Invitation, Session, User } from "./types";
import type { CreateUserInput } from "./user-provider.interface";

export interface LoginCredentials {
  email: string;
  password?: string;
}

export interface CreateInvitationInput {
  email: string;
  role: string;
  organizationId?: string | null;
  inviterId: string;
  /**
   * Expiration duration in seconds.
   */
  expiresIn?: number;
  headers?: Headers | Record<string, string | string[] | undefined>;
}

export interface IAuthProvider {
  login(credentials: LoginCredentials): Promise<AuthResult>;

  // Added createUser to support Signup flow via Auth Provider
  createUser(input: CreateUserInput): Promise<User>;

  validateSession(
    token: string,
  ): Promise<{ session: Session; user: User } | null>;

  getSessionFromHeaders(
    headers: Headers | Record<string, string | string[] | undefined>,
  ): Promise<{ session: Session; user: User } | null>;

  createInvitation(input: CreateInvitationInput): Promise<Invitation>;

  getInvitation(id: string): Promise<Invitation | null>;

  acceptInvitation(invitationId: string, userId: string): Promise<void>;

  listInvitations(organizationId: string): Promise<Invitation[]>;

  setPassword?(userId: string, password: string): Promise<void>;

  resendVerificationEmail?(email: string): Promise<void>;

  findById(userId: string): Promise<User>;
}

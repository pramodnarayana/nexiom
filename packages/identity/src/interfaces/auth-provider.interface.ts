import { AuthResult, Invitation, Session } from "./types";

export interface LoginCredentials {
  email: string;
  password?: string;
}

export interface CreateInvitationInput {
  email: string;
  role: string;
  organizationId?: string | null;
  inviterId: string;
  expiresIn?: number; // seconds
}

export interface IAuthProvider {
  login(credentials: LoginCredentials): Promise<AuthResult>;

  validateSession(
    token: string,
  ): Promise<{ session: Session; user: any } | null>;

  getSessionFromHeaders(
    headers: any,
  ): Promise<{ session: Session; user: any } | null>;

  createInvitation(input: CreateInvitationInput): Promise<any>; // abstract return type as it might depend on implementation

  getInvitation(id: string): Promise<Invitation | null>;

  acceptInvitation(invitationId: string, userId: string): Promise<void>;

  listInvitations(organizationId: string): Promise<Invitation[]>;

  // Optional: Password management if handled by provider
  setPassword?(userId: string, password: string): Promise<void>;
}

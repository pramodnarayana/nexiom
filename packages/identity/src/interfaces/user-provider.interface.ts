import type { User } from "./types";

export interface CreateUserInput {
  email: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  companyName?: string; // Optional: for auto-provisioning
}

export interface UpdateUserInput extends Partial<User> {
  password?: string;
}

export interface IUserProvider {
  create(input: CreateUserInput): Promise<User>;

  update(id: string, input: UpdateUserInput): Promise<User>;

  delete(id: string): Promise<void>;

  findById(id: string): Promise<User | null>;

  findByEmail(email: string): Promise<User | null>;

  findAll(options?: {
    page?: number;
    limit?: number;
    search?: string;
    tenantId?: string;
  }): Promise<{ data: User[]; total: number }>;

  // Kept for backward compatibility if needed, but the above covers it
  // findAll(tenantId?: string): Promise<User[]>; // Removed in favor of options

  forceVerifyEmail(userId: string): Promise<void>;

  count(filters?: { tenantId?: string; search?: string }): Promise<number>;

  /**
   * Atomically delete a user only if they are not the last admin in the organization.
   * This operation is performed in a single transaction to prevent TOCTOU race conditions.
   *
   * @param userId - ID of the user to delete
   * @param tenantId - ID of the tenant/organization
   * @returns true if deleted, false if user was the last admin
   * @throws NotFoundException if user doesn't exist or isn't a member of the tenant
   */
  deleteIfNotLastAdmin(
    userId: string,
    tenantId: string,
  ): Promise<{ success: boolean; hardDeleted?: boolean }>;
}

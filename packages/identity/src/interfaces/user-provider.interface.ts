import { User } from "./types";

export interface CreateUserInput {
  email: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  systemRole?: string;
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

  count(filters?: {
    tenantId?: string;
    search?: string;
    systemRole?: string;
  }): Promise<number>;
}

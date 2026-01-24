import { User } from "./types";

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

  findAll(tenantId?: string): Promise<User[]>;

  forceVerifyEmail(userId: string): Promise<void>;
}

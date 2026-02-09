export interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
}

export interface FindRolesOptions {
  scope?: "system" | "organization";
}

export interface IRoleProvider {
  findAll(options?: FindRolesOptions): Promise<Role[]>;
  findById(id: string): Promise<Role | null>;
}

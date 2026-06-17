export interface RoleEntity {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
}

export interface FindRolesOptions {
  scope?: "system" | "organization";
}

export interface CreateRoleInput {
  name: string;
  description?: string;
  isSystem?: boolean;
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
}

export interface RoleRepositoryPort {
  findAll(options?: FindRolesOptions): Promise<RoleEntity[]>;
  /**
   * Finds a role by ID.
   * Returns null if not found.
   */
  findById(id: string): Promise<RoleEntity | null>;

  /**
   * Creates a new role.
   */
  create(input: CreateRoleInput): Promise<RoleEntity>;

  /**
   * Updates a role.
   * Throws NotFoundException if role does not exist.
   */
  update(id: string, input: UpdateRoleInput): Promise<RoleEntity>;

  /**
   * Deletes a role.
   * Throws NotFoundException if role does not exist.
   */
  delete(id: string): Promise<void>;
}

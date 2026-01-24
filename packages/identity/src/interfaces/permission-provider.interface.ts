import { User } from "./types";

export type PermissionAction =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "manage";
export type PermissionResource = string; // e.g. 'user', 'tenant', 'settings', 'billing', 'api_key'

export interface IPermissionProvider {
  /**
   * Check if a user has permission to perform an action on a resource within a specific context (tenant).
   */
  can(
    user: User,
    action: PermissionAction,
    resource: PermissionResource,
    tenantId?: string,
  ): Promise<boolean>;

  /**
   * Check if a user has a specific role.
   * Prefer using capabilities (can) over role checks where possible.
   */
  hasRole(user: User, role: string, tenantId?: string): Promise<boolean>;

  /**
   * Get all permissions for a user in a given context.
   */
  getPermissions(user: User, tenantId?: string): Promise<string[]>;
}

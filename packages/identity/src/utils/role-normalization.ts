/**
 * Interface representing a normalized role structure.
 */
export interface NormalizedRole {
  id: string;
  name: string;
  permissions: {
    permissionId: string;
    conditions?: unknown; // JSONB
    permission?: {
      action: string;
      resource: string;
    };
  }[];
}

/**
 * Parses and normalizes a role from various possible input formats.
 * Handles:
 * - String roles (legacy IDs)
 * - Object roles (with id, name, permissions)
 *
 * @param rawRole The raw role data to parse
 * @returns A normalized role object
 */
export function normalizeRole(rawRole: unknown): NormalizedRole {
  let roleName = "unknown";
  let roleId = "unknown";
  let permissions: NormalizedRole["permissions"] = [];

  if (typeof rawRole === "string") {
    roleName = rawRole;
    roleId = rawRole;
  } else if (
    rawRole &&
    typeof rawRole === "object" &&
    "name" in rawRole &&
    "id" in rawRole
  ) {
    const roleObj = rawRole as {
      id: string;
      name: string;
      permissions?: any[];
    };
    roleName = roleObj.name;
    roleId = roleObj.id;

    if (Array.isArray(roleObj.permissions)) {
      permissions = roleObj.permissions as NormalizedRole["permissions"];
    }
  }

  return {
    id: roleId,
    name: roleName,
    permissions,
  };
}

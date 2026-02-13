import { Role } from "../constants";

/**
 * Filter roles based on the requester's role to prevent privilege escalation.
 *
 * Rules:
 * - Only 'Owner' can see/assign the 'Owner' role.
 * - Everyone else sees all roles EXCEPT 'Owner'.
 *
 * @param roles List of all available roles
 * @param requesterRole The role of the user making the request
 * @returns Filtered list of roles
 */
export function filterRolesForRequester<T extends { name: string }>(
  roles: T[],
  requesterRole: string,
): T[] {
  // Enterprise-Grade Check:
  // Use the defined Role enum for comparison to avoid magic strings.
  // Ensure case-insensitive comparison to handle legacy/mixed casing (e.g., 'Owner' vs 'owner').
  // Handle empty or undefined requesterRole safely
  if (!requesterRole) {
    return roles.filter(
      (r) => r.name.toLowerCase() !== Role.Owner.toLowerCase(),
    );
  }

  const isOwner = requesterRole.toLowerCase() === Role.Owner.toLowerCase();

  if (!isOwner) {
    return roles.filter(
      (r) => r.name.toLowerCase() !== Role.Owner.toLowerCase(),
    );
  }

  return roles;
}

import { Role } from '@nexiom/identity';

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
export function filterRolesForRequester(
  roles: { name: string }[],
  requesterRole: string,
): { name: string }[] {
  const isOwner = requesterRole.toLowerCase() === Role.Owner.toLowerCase();

  if (!isOwner) {
    return roles.filter(
      (r) => r.name.toLowerCase() !== Role.Owner.toLowerCase(),
    );
  }

  return roles;
}

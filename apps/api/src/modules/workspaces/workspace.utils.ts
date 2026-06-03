import { UnauthorizedException } from '@nestjs/common';
import type { RequestAuthContext } from '@soopa/auth';

/**
 * Extracts the organisation ID from the auth context.
 * Throws UnauthorizedException if the user has no organisation context
 * (e.g. system admin hitting a tenant-scoped endpoint without an active org).
 */
export function requireOrgId(auth: RequestAuthContext): string {
  const orgId = auth.user?.organizationId;
  if (!orgId) throw new UnauthorizedException('No organisation context.');
  return orgId;
}

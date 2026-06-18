import { createHash } from 'node:crypto';

/**
 * Computes the deterministic physical PostgreSQL schema name for a tenant's workspace connection.
 * Used for Tenant-per-Database physical isolation.
 *
 * @param tenantId The UUID of the tenant
 * @param appName The provider/app name (e.g., "salesforce", "quickbooks")
 * @param organizationId The unique identifier of the 3rd party account (e.g. Realm ID, Org ID)
 * @returns The isolated schema name (e.g., "ws_salesforce_8f3a9b...")
 */
export function getWorkspaceSchemaName(
  tenantId: string,
  appName: string,
  organizationId: string,
): string {
  if (!organizationId || organizationId.trim() === '') {
    throw new Error(
      `organizationId is strictly required to generate a workspace schema name for ${appName}. The provider must return a unique tenant identifier.`,
    );
  }

  const deterministicKey = `${tenantId}-${organizationId}`;

  const hashedSuffix = createHash('sha256')
    .update(deterministicKey)
    .digest('hex')
    .substring(0, 16);

  const sanitizedProvider = appName.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
  const finalProviderToken = sanitizedProvider || 'unknown';
  const safeToken = finalProviderToken.substring(0, 40);

  return `ws_${safeToken}_${hashedSuffix}`;
}

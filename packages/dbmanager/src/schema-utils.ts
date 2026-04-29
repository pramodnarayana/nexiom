import { createHash } from 'node:crypto';

/**
 * Computes the deterministic physical PostgreSQL schema name for a tenant's workspace connection.
 * Used for Tenant-per-Database physical isolation.
 *
 * @param connectionId The UUID of the app_connection
 * @param appName The provider/app name (e.g., "salesforce", "quickbooks")
 * @returns The isolated schema name (e.g., "ws_salesforce_8f3a9b...")
 */
export function getWorkspaceSchemaName(
  connectionId: string,
  appName: string,
): string {
  const hashedSuffix = createHash('sha256')
    .update(connectionId)
    .digest('hex')
    .substring(0, 16);

  const sanitizedProvider = appName.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
  const finalProviderToken = sanitizedProvider || 'unknown';
  const safeToken = finalProviderToken.substring(0, 40);

  return `ws_${safeToken}_${hashedSuffix}`;
}

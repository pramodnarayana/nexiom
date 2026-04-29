import { Injectable, NotFoundException } from '@nestjs/common';

export type HostContext = {
  databaseHostUrl: string;
  regionContext: string;
};

@Injectable()
export class StorageResolverService {
  constructor() {}

  /**
   * Resolves the physical PostgreSQL schema name for a connection.
   * Used by Ingestion and Replica workers for 'SET search_path'.
   */
  async resolveSchemaName(connectionId: string): Promise<string> {
    // In Tenant-per-Database, the schema name is purely deterministic
    // Normalize to lowercase and replace any non-alphanumeric/underscore with '_'
    let sanitized = connectionId.toLowerCase().replaceAll(/[^a-z0-9_]/g, '_');

    // Ensure the first character is a letter or underscore (prefix '_' if starts with digit)
    if (sanitized.length > 0 && /^[0-9]/.test(sanitized)) {
      sanitized = '_' + sanitized;
    }

    // Truncate to Postgres max identifier length (63 bytes)
    if (sanitized.length > 63) {
      sanitized = sanitized.substring(0, 63);
    }

    // Ensure non-empty
    if (!sanitized) {
      throw new Error(`Cannot derive valid schema name from connectionId: ${connectionId}`);
    }

    return `ws_${sanitized}`;
  }

  /**
   * Retrieves host and region context for the connection.
   * Critical for multi-region routing and residency compliance.
   */
  async getHostContext(connectionId: string): Promise<HostContext> {
    throw new Error(
      `getHostContext not yet implemented for tenant-per-database architecture (connectionId: ${connectionId}). ` +
      `Requires resolving tenantId and querying TenantStorageRegistry.`
    );
  }
}

import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@nexiom/database';
import type { DrizzleDb } from '@nexiom/database';
import { appConnections } from '@nexiom/database';
import { eq } from 'drizzle-orm';

export type HostContext = {
  databaseHostUrl: string;
  regionContext: string;
};

/** Maximum number of entries held in the in-memory LRU cache. */
const CACHE_MAX_SIZE = 1_000;

/**
 * StorageResolverService
 *
 * Resolves the physical PostgreSQL schema name for a given connection ID.
 *
 * Design:
 *   - `schema_name` is a first-class column on `app_connection`, written once
 *     at connection-creation time by `ConnectorsService`. It is immutable.
 *   - This service performs a single primary-key-indexed SELECT and caches
 *     the result permanently — schema names never change, so the cache is
 *     always valid for the lifetime of the process.
 *   - No schema-name computation happens here. The computation lives exclusively
 *     in `getWorkspaceSchemaName()` (packages/dbmanager), called only at write
 *     time. This eliminates the risk of two places computing different names.
 *
 * Performance:
 *   - Cache hit: O(1) Map lookup, zero DB round-trips.
 *   - Cache miss: one indexed SELECT on the primary key (UUID).
 *   - LRU eviction keeps memory bounded at CACHE_MAX_SIZE entries.
 */
@Injectable()
export class StorageResolverService {
  /** LRU cache: connectionId → { schemaName, tenantId }. Entries are never invalidated. */
  private readonly cache = new Map<string, { schemaName: string; tenantId: string }>();

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async resolveStorageProfile(
    connectionId: string,
  ): Promise<{ schemaName: string; tenantId: string }> {
    if (!connectionId) {
      throw new Error('connectionId must be a non-empty string');
    }

    // ── Fast path: cache hit ──────────────────────────────────────────────────
    const cached = this.cache.get(connectionId);
    if (cached) return cached;

    // ── Slow path: DB lookup ──────────────────────────────────────────────────
    const [row] = await this.db
      .select({
        schemaName: appConnections.schemaName,
        tenantId: appConnections.tenantId,
      })
      .from(appConnections)
      .where(eq(appConnections.id, connectionId))
      .limit(1);

    if (!row?.schemaName || !row?.tenantId) {
      throw new NotFoundException(
        `Cannot resolve storage profile for connection "${connectionId}". ` +
          `The connection may not exist or schema_name/tenant_id was not set.`,
      );
    }

    // ── Populate cache with LRU eviction ─────────────────────────────────────
    if (this.cache.size >= CACHE_MAX_SIZE) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    const profile = { schemaName: row.schemaName, tenantId: row.tenantId };
    this.cache.set(connectionId, profile);

    return profile;
  }

  /**
   * Returns the physical PostgreSQL schema name for `connectionId`.
   * Legacy method for callers that only need the schema name.
   */
  async resolveSchemaName(connectionId: string): Promise<string> {
    const profile = await this.resolveStorageProfile(connectionId);
    return profile.schemaName;
  }

  /**
   * Retrieves host and region context for the connection.
   * Critical for multi-region routing and residency compliance.
   */
  async getHostContext(connectionId: string): Promise<HostContext> {
    throw new Error(
      `getHostContext not yet implemented for tenant-per-database architecture ` +
      `(connectionId: ${connectionId}). ` +
      `Requires resolving tenantId and querying TenantStorageRegistry.`,
    );
  }
}

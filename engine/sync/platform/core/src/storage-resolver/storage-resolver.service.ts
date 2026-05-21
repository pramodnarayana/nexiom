import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@nexiom/database';
import type { DrizzleDb } from '@nexiom/database';
import { dataSources } from '@nexiom/database';
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
 * Resolves the physical PostgreSQL schema name for a given data source ID.
 *
 * Design:
 *   - `schema_name` is a first-class column on `dataSources`, written once
 *     at data-source creation time. It is immutable.
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
  /** LRU cache: dataSourceId → { schemaName, tenantId }. Entries are never invalidated. */
  private readonly cache = new Map<string, { schemaName: string; tenantId: string }>();

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async resolveStorageProfile(
    dataSourceId: string,
  ): Promise<{ schemaName: string; tenantId: string }> {
    if (!dataSourceId) {
      throw new Error('dataSourceId must be a non-empty string');
    }

    // ── Fast path: cache hit with LRU update ──────────────────────────────────
    const cached = this.cache.get(dataSourceId);
    if (cached) {
      // Update LRU insertion order by removing and re-inserting
      this.cache.delete(dataSourceId);
      this.cache.set(dataSourceId, cached);
      return cached;
    }

    // ── Slow path: DB lookup ──────────────────────────────────────────────────
    const [row] = await this.db
      .select({
        schemaName: dataSources.schemaName,
        tenantId: dataSources.tenantId,
      })
      .from(dataSources)
      .where(eq(dataSources.id, dataSourceId))
      .limit(1);

    if (!row?.schemaName || !row?.tenantId) {
      throw new NotFoundException(
        `Cannot resolve storage profile for data source "${dataSourceId}". ` +
          `The data source may not exist or schema_name/tenant_id was not set.`,
      );
    }

    // ── Validate schemaName format before caching ─────────────────────────────
    const schemaNamePattern = /^[a-z0-9_]+$/i;
    if (!schemaNamePattern.test(row.schemaName)) {
      throw new NotFoundException(
        `Invalid schema_name format for data source "${dataSourceId}": "${row.schemaName}". ` +
          `Schema names must contain only alphanumeric characters and underscores.`,
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
    this.cache.set(dataSourceId, profile);

    return profile;
  }

  /**
   * Returns the physical PostgreSQL schema name for `dataSourceId`.
   * Legacy method for callers that only need the schema name.
   */
  async resolveSchemaName(dataSourceId: string): Promise<string> {
    const profile = await this.resolveStorageProfile(dataSourceId);
    return profile.schemaName;
  }

  /**
   * Retrieves host and region context for the connection.
   * Critical for multi-region routing and residency compliance.
   */
  async getHostContext(dataSourceId: string): Promise<HostContext> {
    throw new Error(
      `getHostContext not yet implemented for tenant-per-database architecture ` +
      `(dataSourceId: ${dataSourceId}). ` +
      `Requires resolving tenantId and querying TenantStorageRegistry.`,
    );
  }
}

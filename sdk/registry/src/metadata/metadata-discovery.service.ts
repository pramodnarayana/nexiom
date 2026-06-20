import {
  Injectable,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and, notInArray, sql } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  connectorObjectProfiles,
  dataSources,
} from '@soopa/database';
import { type IKeyValueStore } from '@soopa/cache';
import { TokenManagerService } from '@soopa/credentials';
import { PieceRegistryService } from '../pieces/piece-registry.service.js';
import type { OAuthCredentialBlob } from '@soopa/credentials';
import type {
  ObjectDescriptor,
  FieldDescriptor,
  ConfigOption,
  RelatedObjectDescriptor,
} from '@soopa/piece-framework';

// Single source of truth for metadata cache TTL.
const TTL_SECONDS = 5 * 60; // 5 minutes
const TTL_MS = TTL_SECONDS * 1_000;

/** Default cap when METADATA_MAX_OBJECTS is not set. */
const DEFAULT_MAX_OBJECTS = 2000;

/**
 * Combined shape stored in connectorObjectProfiles.profile.
 * Both describeObjects and describeFields write into this envelope using a
 * jsonb-merge (COALESCE || EXCLUDED) so each writer preserves the keys it
 * does not own:
 *  - describeObjects writes descriptor + position; preserves fields.
 *  - describeFields writes fields; preserves descriptor + position.
 * Reading code should always branch on the presence of individual keys rather
 * than assuming the whole shape was written by one caller.
 */
interface CombinedProfile {
  /** Object-level metadata written by describeObjects. */
  descriptor?: { label: string; queryable: boolean };
  /** Field list written by describeFields. undefined = not yet fetched; [] = fetched, no fields. */
  fields?: FieldDescriptor[];
  /** Stable sort position from the live describeObjects response; used to restore ordering after a Redis eviction. */
  position?: number;
}

@Injectable()
export class MetadataDiscoveryService implements OnModuleInit {
  private readonly logger = new Logger(MetadataDiscoveryService.name);
  private readonly maxObjects: number;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject('KEY_VALUE_STORE') private readonly redis: IKeyValueStore,
    private readonly pieceRegistry: PieceRegistryService,
    private readonly tokenManager: TokenManagerService,
    private readonly config: ConfigService,
  ) {
    const raw = this.config.get<string>('METADATA_MAX_OBJECTS');
    const parsed = raw !== undefined ? parseInt(raw, 10) : NaN;
    this.maxObjects =
      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_OBJECTS;
  }

  async onModuleInit() {
    this.logger.log(
      `MetadataDiscoveryService initialised — MAX_OBJECTS=${this.maxObjects}`,
    );
    this.cleanupLegacyCacheKeys().catch(err => {
      this.logger.error('Failed to cleanup legacy metadata cache keys', err);
    });
  }

  private async cleanupLegacyCacheKeys(): Promise<void> {
    const migrationFlag = 'migration:meta_cache_cleanup_datasource_id';
    const token = `${Date.now()}-${Math.random()}`;

    // Atomically claim the migration with a 60-second timeout using a unique token
    const claimed = await this.redis.set(migrationFlag, token, 'EX', 60, 'NX');
    if (!claimed) {
      // Another instance is running or has completed the migration
      return;
    }

    // Lua script for compare-and-delete
    const compareAndDelete = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    try {
      this.logger.log('One-time init: clearing legacy connectionId-based cache keys (meta:*)');
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'meta:*', 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await Promise.all(keys.map(key => this.redis.del(key)));
        }
      } while (cursor !== '0');

      // Persist the flag without expiration to mark completion
      await this.redis.set(migrationFlag, '1');
      this.logger.log('Legacy metadata cache keys cleared.');
    } catch (err) {
      // On failure, only delete the claim if we still own it
      await this.redis.eval(compareAndDelete, 1, migrationFlag, token);
      throw err;
    }
  }

  async describeObjects(
    orgId: string,
    dataSourceId: string,
    limit = this.maxObjects,
    forceRefresh = false,
  ): Promise<ObjectDescriptor[]> {
    const effectiveLimit = Math.max(1, Math.min(limit, this.maxObjects));
    const dataSource = await this.resolveDataSource(orgId, dataSourceId);

    // ── 1. Redis cache ───────────────────────────────────────────────────────
    const redisKey = `meta:objects:${dataSourceId}`;

    if (forceRefresh) {
      // Bust both caches so this request and all subsequent ones get fresh data.
      await this.redis.del(redisKey);
    } else {
      const cached = await this.redis.get(redisKey);
      if (cached) {
        const all = JSON.parse(cached) as ObjectDescriptor[];
        return all.slice(0, effectiveLimit);
      }
    }

    // ── 2. DB cache (skipped on forceRefresh) ────────────────────────────────
    if (!forceRefresh) {
      const dbRows = await this.db
        .select()
        .from(connectorObjectProfiles)
        .where(eq(connectorObjectProfiles.dataSourceId, dataSourceId));

      if (dbRows.length > 0) {
        const allFresh = dbRows.every(
          (row) =>
            row.updatedAt &&
            Date.now() - new Date(row.updatedAt).getTime() < TTL_MS,
        );
        if (allFresh) {
          // Sort by stored position so ordering matches the original live-fetch
          // response even after a Redis eviction.  Rows without a position (e.g.
          // written by an older schema or solely by describeFields) sort last.
          dbRows.sort((a, b) => {
            const posA =
              (a.profile as CombinedProfile | null)?.position ?? Infinity;
            const posB =
              (b.profile as CombinedProfile | null)?.position ?? Infinity;
            return posA - posB;
          });

          const objects: ObjectDescriptor[] = dbRows.map((row) => {
            const descriptor =
              (row.profile as CombinedProfile | null)?.descriptor ?? null;
            return {
              name: row.objectName,
              // Fall back to objectName only when no descriptor exists (row was
              // written solely by describeFields before describeObjects ran).
              label: descriptor?.label ?? row.objectName,
              // Preserve queryable=false explicitly — nullish coalescing only
              // defaults to true when descriptor is absent, not when it is false.
              queryable: descriptor?.queryable ?? true,
            };
          });
          await this.redis.set(
            redisKey,
            JSON.stringify(objects),
            'EX',
            TTL_SECONDS,
          );
          return objects.slice(0, effectiveLimit);
        }
      }
    }

    // ── 3. Live fetch (piece → Prism fallback) ───────────────────────────────
    const credentials = await this.resolveCredentials(dataSourceId);
    const objects = await this.fetchObjects(dataSource.appName, credentials);

    // Emit a warning when the discovered count approaches the configured cap
    // (> 75%) so operators can raise METADATA_MAX_OBJECTS before objects are silently truncated.
    if (objects.length > this.maxObjects * 0.75) {
      this.logger.warn(
        `describeObjects: connector "${dataSource.appName}" returned ${objects.length} objects — ` +
          `exceeds 75% of MAX_OBJECTS limit (${this.maxObjects}). ` +
          `Raise METADATA_MAX_OBJECTS env var if truncation is undesirable.`,
      );
    }

    await this.redis.set(redisKey, JSON.stringify(objects), 'EX', TTL_SECONDS);

    // Batch upsert: write descriptor + position into the combined profile envelope.
    // Uses a jsonb merge (COALESCE || EXCLUDED) so any fields written by a prior
    // describeFields call are preserved — descriptor and fields never overwrite
    // each other, they coexist under the same row.
    // Always run a transaction: upsert + targeted stale-delete when objects is
    // non-empty; full delete for the dataSourceId when upstream returns nothing.
    // This prevents orphaned rows from lingering when a connector reports zero objects.
    await this.db.transaction(async (tx) => {
      if (objects.length > 0) {
        const currentNames = objects.map((o) => o.name);

        await tx
          .insert(connectorObjectProfiles)
          .values(
            objects.map((obj, idx) => ({
              dataSourceId,
              objectName: obj.name,
              profile: {
                descriptor: { label: obj.label, queryable: obj.queryable },
                position: idx,
              } as unknown as Record<string, unknown>,
            })),
          )
          .onConflictDoUpdate({
            target: [
              connectorObjectProfiles.dataSourceId,
              connectorObjectProfiles.objectName,
            ],
            // Merge existing profile (may contain fields from describeFields) with
            // the incoming descriptor+position via jsonb concatenation.  Right-side
            // keys (EXCLUDED) take precedence, so descriptor and position are always
            // refreshed while an existing fields key is preserved.
            set: {
              profile: sql`COALESCE(${connectorObjectProfiles.profile}, '{}'::jsonb) || "excluded"."profile"`,
              updatedAt: new Date(),
            },
          });

        // Remove objects that no longer exist upstream so stale rows don't linger.
        await tx
          .delete(connectorObjectProfiles)
          .where(
            and(
              eq(connectorObjectProfiles.dataSourceId, dataSourceId),
              notInArray(connectorObjectProfiles.objectName, currentNames),
            ),
          );
      } else {
        // Upstream returned an empty list — purge all cached rows for this connection.
        await tx
          .delete(connectorObjectProfiles)
          .where(eq(connectorObjectProfiles.dataSourceId, dataSourceId));
      }
    });

    return objects.slice(0, effectiveLimit);
  }

  async describeFields(
    orgId: string,
    dataSourceId: string,
    objectName: string,
    forceRefresh = false,
  ): Promise<FieldDescriptor[]> {
    const dataSource = await this.resolveDataSource(orgId, dataSourceId);

    // ── 1. Redis cache ───────────────────────────────────────────────────────
    const redisKey = `meta:fields:${dataSourceId}:${objectName}`;

    if (forceRefresh) {
      // Bust Redis so neither this request nor the DB-cache read below serves stale data.
      await this.redis.del(redisKey);
    } else {
      const cached = await this.redis.get(redisKey);
      if (cached) {
        return JSON.parse(cached) as FieldDescriptor[];
      }
    }

    // ── 2. DB cache (skipped on forceRefresh) ────────────────────────────────
    if (!forceRefresh) {
      const [dbRow] = await this.db
        .select()
        .from(connectorObjectProfiles)
        .where(
          and(
            eq(connectorObjectProfiles.dataSourceId, dataSourceId),
            eq(connectorObjectProfiles.objectName, objectName),
          ),
        )
        .limit(1);

      if (
        dbRow?.updatedAt &&
        Date.now() - new Date(dbRow.updatedAt).getTime() < TTL_MS
      ) {
        const profile = dbRow.profile as CombinedProfile | null;
        // fields === undefined means describeFields has never run for this object;
        // fields === [] is a valid cache hit (connector returned no fields).
        if (profile?.fields !== undefined) {
          await this.redis.set(
            redisKey,
            JSON.stringify(profile.fields),
            'EX',
            TTL_SECONDS,
          );
          return profile.fields;
        }
      }
    }

    // ── 3. Live fetch (piece → Prism fallback) ───────────────────────────────
    const credentials = await this.resolveCredentials(dataSourceId);
    const fields = await this.fetchFields(
      dataSource.appName,
      objectName,
      credentials,
    );

    this.logger.debug(
      `[describeFields] ${dataSource.appName}:${objectName} → ${fields.length} fields: ` +
      fields.slice(0, 8).map((f) => f.name).join(', ') +
      (fields.length > 8 ? ` … (+${fields.length - 8} more)` : ''),
    );


    await this.redis.set(redisKey, JSON.stringify(fields), 'EX', TTL_SECONDS);

    // Write fields into the combined profile envelope, merging with any existing
    // descriptor + position written by describeObjects.  Right-side keys (EXCLUDED)
    // take precedence so fields is always refreshed; descriptor and position survive.
    await this.db
      .insert(connectorObjectProfiles)
      .values({
        dataSourceId,
        objectName,
        profile: { fields } as unknown as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: [
          connectorObjectProfiles.dataSourceId,
          connectorObjectProfiles.objectName,
        ],
        set: {
          profile: sql`COALESCE(${connectorObjectProfiles.profile}, '{}'::jsonb) || "excluded"."profile"`,
          updatedAt: new Date(),
        },
      });

    return fields;
  }

  async describeRelatedObjects(
    orgId: string,
    dataSourceId: string,
    objectName: string,
    forceRefresh = false,
  ): Promise<RelatedObjectDescriptor[]> {
    const dataSource = await this.resolveDataSource(orgId, dataSourceId);

    // ── 1. Redis cache ────────────────────────────────────────────────────────────
    const redisKey = `meta:related:${dataSourceId}:${objectName}`;
    if (forceRefresh) {
      await this.redis.del(redisKey);
    } else {
      const cached = await this.redis.get(redisKey);
      if (cached) {
        return JSON.parse(cached) as RelatedObjectDescriptor[];
      }
    }

    // ── 2. Live fetch (piece) ──────────────────────────────────────────────────
    const piece = this.pieceRegistry.getPiece(dataSource.appName);
    if (!piece) {
      throw new NotFoundException(
        `Connector "${dataSource.appName}" not found.`,
      );
    }
    if (!piece.describeRelatedObjects) {
      throw new NotFoundException(
        `Connector "${dataSource.appName}" does not support related object discovery.`,
      );
    }

    const credentials = await this.resolveCredentials(dataSourceId);

    let related: RelatedObjectDescriptor[];
    try {
      related = await piece.describeRelatedObjects(credentials, objectName);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new ServiceUnavailableException(
        `Connector "${dataSource.appName}" failed to describe related objects: ${msg}`,
      );
    }

    await this.hydrateObjectLabels(related, orgId, dataSourceId, objectName);
    await this.redis.set(redisKey, JSON.stringify(related), 'EX', TTL_SECONDS);
    return related;
  }

  private async hydrateObjectLabels(
    related: RelatedObjectDescriptor[],
    orgId: string,
    dataSourceId: string,
    objectName: string,
  ): Promise<void> {
    try {
      const objects = await this.describeObjects(orgId, dataSourceId);
      const objectMap = new Map(objects.map((o) => [o.name, o.label]));
      for (const r of related) {
        if (!r.objectLabel && objectMap.has(r.objectName)) {
          r.objectLabel = objectMap.get(r.objectName);
        }
      }
    } catch (labelErr: unknown) {
      const msg = labelErr instanceof Error ? labelErr.message : String(labelErr);
      this.logger.warn(
        `Failed to hydrate object labels for related objects of ${objectName}: ${msg}`,
      );
    }
  }

  async describeConfig(
    orgId: string,
    dataSourceId: string,
  ): Promise<ConfigOption[]> {
    const dataSource = await this.resolveDataSource(orgId, dataSourceId);

    // ── 1. Redis cache ─────────────────────────────────────────────────────────
    const redisKey = `meta:config:${dataSourceId}`;
    const cached = await this.redis.get(redisKey);
    if (cached) {
      return JSON.parse(cached) as ConfigOption[];
    }

    // ── 2. Live fetch ──────────────────────────────────────────────────────────
    const piece = this.pieceRegistry.getPiece(dataSource.appName);
    if (!piece) {
      throw new NotFoundException(
        `Connector "${dataSource.appName}" not found.`,
      );
    }

    // Config is an optional capability — return [] when piece doesn't implement it.
    if (!piece.describeConfig) {
      return [];
    }

    const credentials = await this.resolveCredentials(dataSourceId);

    let config: ConfigOption[];
    try {
      config = await piece.describeConfig(credentials);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new ServiceUnavailableException(
        `Connector "${dataSource.appName}" failed to describe config: ${msg}`,
      );
    }

    try {
      await this.redis.set(redisKey, JSON.stringify(config), 'EX', TTL_SECONDS);
    } catch (cacheErr: unknown) {
      const msg = cacheErr instanceof Error ? cacheErr.message : String(cacheErr);
      this.logger.warn(
        `Failed to cache config for ${dataSource.appName}: ${msg}`,
      );
      // Cache failure is non-fatal — the caller still receives fresh data.
    }

    return config;
  }

  async countRecords(
    orgId: string,
    dataSourceId: string,
    objectName: string,
  ): Promise<number | null> {
    const dataSource = await this.resolveDataSource(orgId, dataSourceId);
    const piece = this.pieceRegistry.getPiece(dataSource.appName);

    if (!piece?.countRecords) {
      return null;
    }

    const credentials = await this.resolveCredentials(dataSourceId);
    try {
      return await piece.countRecords(credentials, objectName);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `Connector ${dataSource.appName} failed to count records for ${objectName}: ${msg}`,
      );
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Fetches the data source row, enforcing org ownership. */
  private async resolveDataSource(orgId: string, dataSourceId: string) {
    const [dataSource] = await this.db
      .select({ appName: dataSources.appName })
      .from(dataSources)
      .where(
        and(
          eq(dataSources.id, dataSourceId),
          eq(dataSources.tenantId, orgId),
        ),
      )
      .limit(1);

    if (!dataSource) {
      throw new NotFoundException(`Data source ${dataSourceId} not found.`);
    }
    return dataSource;
  }

  /**
   * Returns a flat credentials map for the given connection, with a valid
   * (non-expired) access token.  Token refresh, distributed locking, and
   * REVOKED-status marking are all handled by TokenManagerService so this
   * service does not duplicate that logic.
   */
  private async resolveCredentials(
    dataSourceId: string,
  ): Promise<Record<string, unknown>> {
    try {
      // TokenManagerService.getValidCredentials checks expiresAt with a 5-minute
      // buffer, acquires a Redis lock, calls the vendor token endpoint if needed,
      // and persists the refreshed token — all in one call.
      const blob: OAuthCredentialBlob =
        await this.tokenManager.getValidCredentials(dataSourceId);

      // Layer order (last write wins):
      //   1. All top-level blob scalars (clientId, clientSecret, environment, …)
      //   2. Vendor extras in blob.data (instance_url, realmId, …)
      //   3. vendorParams template values (environment override, subdomain, …)
      //   4. Canonical token fields — always authoritative, never overridable.
      return {
        ...blob,
        ...blob.data,
        ...blob.vendorParams,
        accessToken: blob.accessToken,
        refreshToken: blob.refreshToken,
        clientId: blob.clientId,
        clientSecret: blob.clientSecret,
      };
    } catch (e) {
      if (e instanceof InternalServerErrorException) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `Failed to resolve credentials for connection ${dataSourceId}: ${msg}`,
      );
      throw new InternalServerErrorException(
        'Failed to retrieve connection credentials.',
      );
    }
  }

  private async fetchObjects(
    appName: string,
    credentials: Record<string, unknown>,
  ): Promise<ObjectDescriptor[]> {
    const piece = this.pieceRegistry.getPiece(appName);
    if (!piece?.describeObjects) {
      throw new NotFoundException(
        `Connector "${appName}" does not support metadata discovery. Register a Piece with describeObjects.`,
      );
    }
    
    try {
      return await piece.describeObjects(credentials);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`[fetchObjects] Connector "${appName}" failed: ${msg}`);
      throw new ServiceUnavailableException(
        `Connector "${appName}" failed to fetch objects: ${msg}`,
      );
    }
  }

  private async fetchFields(
    appName: string,
    objectName: string,
    credentials: Record<string, unknown>,
  ): Promise<FieldDescriptor[]> {
    const piece = this.pieceRegistry.getPiece(appName);
    if (!piece?.describeFields) {
      throw new NotFoundException(
        `Connector "${appName}" does not support metadata discovery. Register a Piece with describeFields.`,
      );
    }

    try {
      return await piece.describeFields(credentials, objectName);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`[fetchFields] Connector "${appName}" failed for object ${objectName}: ${msg}`);
      throw new ServiceUnavailableException(
        `Connector "${appName}" failed to fetch fields for ${objectName}: ${msg}`,
      );
    }
  }
}
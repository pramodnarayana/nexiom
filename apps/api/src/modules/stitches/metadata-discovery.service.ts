import {
  Injectable,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and, notInArray, sql } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  connectorObjectProfiles,
  safeAppConnectionColumns,
  appConnections,
} from '@nexiom/database';
import { REDIS_CLIENT, type Redis } from '@nexiom/cache';
import { TokenManagerService } from '@nexiom/connectors';
import { PieceRegistryService } from '@nexiom/engine';
import type { OAuthCredentialBlob } from '@nexiom/connectors';
import type {
  ObjectDescriptor,
  FieldDescriptor,
  ConfigOption,
  RelatedObjectDescriptor,
} from '@nexiom/piece-framework';

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
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly pieceRegistry: PieceRegistryService,
    private readonly tokenManager: TokenManagerService,
    private readonly config: ConfigService,
  ) {
    const raw = this.config.get<string>('METADATA_MAX_OBJECTS');
    const parsed = raw !== undefined ? parseInt(raw, 10) : NaN;
    this.maxObjects =
      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_OBJECTS;
  }

  onModuleInit() {
    this.logger.log(
      `MetadataDiscoveryService initialised — MAX_OBJECTS=${this.maxObjects}`,
    );
  }

  async describeObjects(
    orgId: string,
    connectionId: string,
    limit = this.maxObjects,
    forceRefresh = false,
  ): Promise<ObjectDescriptor[]> {
    const effectiveLimit = Math.max(1, Math.min(limit, this.maxObjects));
    const connection = await this.resolveConnection(orgId, connectionId);

    // ── 1. Redis cache ───────────────────────────────────────────────────────
    const redisKey = `meta:objects:${connectionId}`;

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
        .where(eq(connectorObjectProfiles.connectionId, connectionId));

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
    const credentials = await this.resolveCredentials(connectionId);
    const objects = await this.fetchObjects(connection.appName, credentials);

    // Emit a warning when the discovered count approaches the configured cap
    // (> 75%) so operators can raise METADATA_MAX_OBJECTS before objects are silently truncated.
    if (objects.length > this.maxObjects * 0.75) {
      this.logger.warn(
        `describeObjects: connector "${connection.appName}" returned ${objects.length} objects — ` +
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
    // non-empty; full delete for the connectionId when upstream returns nothing.
    // This prevents orphaned rows from lingering when a connector reports zero objects.
    await this.db.transaction(async (tx) => {
      if (objects.length > 0) {
        const currentNames = objects.map((o) => o.name);

        await tx
          .insert(connectorObjectProfiles)
          .values(
            objects.map((obj, idx) => ({
              connectionId,
              objectName: obj.name,
              profile: {
                descriptor: { label: obj.label, queryable: obj.queryable },
                position: idx,
              } as unknown as Record<string, unknown>,
            })),
          )
          .onConflictDoUpdate({
            target: [
              connectorObjectProfiles.connectionId,
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
              eq(connectorObjectProfiles.connectionId, connectionId),
              notInArray(connectorObjectProfiles.objectName, currentNames),
            ),
          );
      } else {
        // Upstream returned an empty list — purge all cached rows for this connection.
        await tx
          .delete(connectorObjectProfiles)
          .where(eq(connectorObjectProfiles.connectionId, connectionId));
      }
    });

    return objects.slice(0, effectiveLimit);
  }

  async describeFields(
    orgId: string,
    connectionId: string,
    objectName: string,
  ): Promise<FieldDescriptor[]> {
    const connection = await this.resolveConnection(orgId, connectionId);

    // ── 1. Redis cache ───────────────────────────────────────────────────────
    const redisKey = `meta:fields:${connectionId}:${objectName}`;
    const cached = await this.redis.get(redisKey);
    if (cached) {
      return JSON.parse(cached) as FieldDescriptor[];
    }

    // ── 2. DB cache ──────────────────────────────────────────────────────────
    const [dbRow] = await this.db
      .select()
      .from(connectorObjectProfiles)
      .where(
        and(
          eq(connectorObjectProfiles.connectionId, connectionId),
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

    // ── 3. Live fetch (piece → Prism fallback) ───────────────────────────────
    const credentials = await this.resolveCredentials(connectionId);
    const fields = await this.fetchFields(
      connection.appName,
      objectName,
      credentials,
    );

    await this.redis.set(redisKey, JSON.stringify(fields), 'EX', TTL_SECONDS);

    // Write fields into the combined profile envelope, merging with any existing
    // descriptor + position written by describeObjects.  Right-side keys (EXCLUDED)
    // take precedence so fields is always refreshed; descriptor and position survive.
    await this.db
      .insert(connectorObjectProfiles)
      .values({
        connectionId,
        objectName,
        profile: { fields } as unknown as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: [
          connectorObjectProfiles.connectionId,
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
    connectionId: string,
    objectName: string,
  ): Promise<RelatedObjectDescriptor[]> {
    const connection = await this.resolveConnection(orgId, connectionId);

    // ── 1. Redis cache ───────────────────────────────────────────────────────
    const redisKey = `meta:related:${connectionId}:${objectName}`;
    const cached = await this.redis.get(redisKey);
    if (cached) {
      return JSON.parse(cached) as RelatedObjectDescriptor[];
    }

    // ── 2. Live fetch (piece) ───────────────────────────────
    const piece = this.pieceRegistry.getPiece(connection.appName);
    if (!piece?.describeRelatedObjects) {
      return [];
    }

    const credentials = await this.resolveCredentials(connectionId);

    let related: RelatedObjectDescriptor[] = [];
    try {
      related = await piece.describeRelatedObjects(credentials, objectName);
      await this.redis.set(
        redisKey,
        JSON.stringify(related),
        'EX',
        TTL_SECONDS,
      );
    } catch (e) {
      this.logger.warn(
        `Connector ${connection.appName} failed to describe related objects: ${String(e)}`,
      );
    }
    return related;
  }

  async describeConfig(
    orgId: string,
    connectionId: string,
  ): Promise<ConfigOption[]> {
    const connection = await this.resolveConnection(orgId, connectionId);

    // ── 1. Redis cache ───────────────────────────────────────────────────────
    const redisKey = `meta:config:${connectionId}`;
    const cached = await this.redis.get(redisKey);
    if (cached) {
      return JSON.parse(cached) as ConfigOption[];
    }

    // ── 2. Live fetch ───────────────────────────────
    const piece = this.pieceRegistry.getPiece(connection.appName);
    if (!piece) {
      throw new NotFoundException(
        `Connector "${connection.appName}" not found.`,
      );
    }

    const credentials = await this.resolveCredentials(connectionId);

    let config: ConfigOption[] = [];
    if (piece.describeConfig) {
      try {
        config = await piece.describeConfig(credentials);
      } catch (e) {
        this.logger.warn(
          `Connector ${connection.appName} failed to describe config: ${String(e)}`,
        );
        config = [];
      }
    }

    await this.redis.set(redisKey, JSON.stringify(config), 'EX', TTL_SECONDS);
    return config;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Fetches the connection row, enforcing org ownership. */
  private async resolveConnection(orgId: string, connectionId: string) {
    const [connection] = await this.db
      .select(safeAppConnectionColumns)
      .from(appConnections)
      .where(
        and(
          eq(appConnections.id, connectionId),
          eq(appConnections.tenantId, orgId),
        ),
      )
      .limit(1);

    if (!connection) {
      throw new NotFoundException(`Connection ${connectionId} not found.`);
    }
    return connection;
  }

  /**
   * Returns a flat credentials map for the given connection, with a valid
   * (non-expired) access token.  Token refresh, distributed locking, and
   * REVOKED-status marking are all handled by TokenManagerService so this
   * service does not duplicate that logic.
   */
  private async resolveCredentials(
    connectionId: string,
  ): Promise<Record<string, unknown>> {
    try {
      // TokenManagerService.getValidCredentials checks expiresAt with a 5-minute
      // buffer, acquires a Redis lock, calls the vendor token endpoint if needed,
      // and persists the refreshed token — all in one call.
      const blob: OAuthCredentialBlob =
        await this.tokenManager.getValidCredentials(connectionId);

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
        `Failed to resolve credentials for connection ${connectionId}: ${msg}`,
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
    if (piece?.describeObjects) {
      return piece.describeObjects(credentials);
    }
    throw new NotFoundException(
      `Connector "${appName}" does not support metadata discovery. Register a Piece with describeObjects.`,
    );
  }

  private async fetchFields(
    appName: string,
    objectName: string,
    credentials: Record<string, unknown>,
  ): Promise<FieldDescriptor[]> {
    const piece = this.pieceRegistry.getPiece(appName);
    if (piece?.describeFields) {
      return piece.describeFields(credentials, objectName);
    }
    throw new NotFoundException(
      `Connector "${appName}" does not support metadata discovery. Register a Piece with describeFields.`,
    );
  }
}

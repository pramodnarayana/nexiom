import {
  Injectable,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
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
import { PieceRegistryService } from '../trigger/piece-registry.service.js';
import type {
  ObjectDescriptor,
  FieldDescriptor,
  OAuthCredentialBlob,
} from '@nexiom/connectors';

// Single source of truth for metadata cache TTL.
const TTL_SECONDS = 5 * 60; // 5 minutes
const TTL_MS = TTL_SECONDS * 1_000;

const MAX_OBJECTS = 2000; // guard against excessively large payloads

/**
 * Shape stored in connectorObjectProfiles.profile when the row was populated
 * by describeObjects (not by describeFields).  Field rows store FieldDescriptor[]
 * (an array), so Array.isArray() distinguishes the two at read time.
 */
interface StoredObjectDescriptor {
  label: string;
  queryable: boolean;
}

@Injectable()
export class MetadataDiscoveryService {
  private readonly logger = new Logger(MetadataDiscoveryService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly pieceRegistry: PieceRegistryService,
    private readonly tokenManager: TokenManagerService,
  ) {}

  async describeObjects(
    orgId: string,
    connectionId: string,
    limit = MAX_OBJECTS,
    forceRefresh = false,
  ): Promise<ObjectDescriptor[]> {
    const effectiveLimit = Math.max(1, Math.min(limit, MAX_OBJECTS));
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
          // profile is StoredObjectDescriptor when set by describeObjects, or
          // FieldDescriptor[] when set by describeFields.  We can always read
          // label / queryable from the stored descriptor; fall back to objectName
          // when the row was first populated by a field-only discovery.
          const objects: ObjectDescriptor[] = dbRows.map((row) => {
            const descriptor =
              !Array.isArray(row.profile) &&
              row.profile !== null &&
              typeof row.profile === 'object'
                ? (row.profile as StoredObjectDescriptor)
                : null;
            return {
              name: row.objectName,
              label: descriptor?.label ?? row.objectName,
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

    await this.redis.set(redisKey, JSON.stringify(objects), 'EX', TTL_SECONDS);

    // Batch upsert: store full ObjectDescriptor in profile so label/queryable
    // survive a Redis eviction and are readable from the DB cache.
    // On conflict, overwrite profile with the fresh StoredObjectDescriptor so
    // the DB-cache read path always has accurate label/queryable values, even
    // when a prior describeFields call wrote a FieldDescriptor[] into the row.
    // describeFields upsert will overwrite profile back to FieldDescriptor[]
    // when it next runs, so there is no loss of field data.
    // Always run a transaction: upsert + targeted stale-delete when objects is
    // non-empty; full delete for the connectionId when upstream returns nothing.
    // This prevents orphaned rows from lingering when a connector reports zero objects.
    await this.db.transaction(async (tx) => {
      if (objects.length > 0) {
        const currentNames = objects.map((o) => o.name);

        await tx
          .insert(connectorObjectProfiles)
          .values(
            objects.map((obj) => ({
              connectionId,
              objectName: obj.name,
              profile: {
                label: obj.label,
                queryable: obj.queryable,
              } as unknown as Record<string, unknown>,
            })),
          )
          .onConflictDoUpdate({
            target: [
              connectorObjectProfiles.connectionId,
              connectorObjectProfiles.objectName,
            ],
            // Reference the incoming row via the EXCLUDED pseudo-table so each
            // conflicting row gets its own fresh profile, not a shared literal.
            set: {
              profile: sql`"excluded"."profile"`,
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
      const profile = dbRow.profile;
      // An empty array [] is a valid cache hit (connector returned no fields).
      // Only skip if profile is not an array (it's a StoredObjectDescriptor).
      if (Array.isArray(profile)) {
        await this.redis.set(
          redisKey,
          JSON.stringify(profile),
          'EX',
          TTL_SECONDS,
        );
        return profile as FieldDescriptor[];
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

    await this.db
      .insert(connectorObjectProfiles)
      .values({
        connectionId,
        objectName,
        profile: fields as unknown as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: [
          connectorObjectProfiles.connectionId,
          connectorObjectProfiles.objectName,
        ],
        set: {
          profile: fields as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        },
      });

    return fields;
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

      // Spread vendor extras first so the canonical token fields always win.
      return {
        ...blob.data,
        ...blob.vendorParams,
        accessToken: blob.accessToken,
        refreshToken: blob.refreshToken,
        clientId: blob.clientId,
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

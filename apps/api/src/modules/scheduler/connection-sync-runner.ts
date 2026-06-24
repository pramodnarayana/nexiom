import {
  Injectable,
  Logger,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import stringify from 'fast-json-stable-stringify';
import { eq, and, sql } from 'drizzle-orm';
import type { DrizzleDb } from '@soopa/database';
import { DATABASE_CONNECTION, dataSources, syncCursors } from '@soopa/database';
import { buildTenantSchema, assertValidSchemaName } from '@soopa/database';
import { TokenManagerService } from '@soopa/credentials';
import type { OAuthCredentialBlob } from '@soopa/credentials';
import type { Piece } from '@soopa/piece-framework';
import { DB_MANAGER, type DatabaseManager } from '@soopa/dbmanager';
import { REDIS_CLIENT, type Redis } from '@soopa/cache';
import {
  StorageResolverService,
  CursorManagerService,
  type StreamBookmark,
  type SyncStateDocument,
  type StreamDescriptor,
  type StreamResult,
} from '@soopa/pipeline';
import { PieceRegistryService } from '@soopa/piece-registry';
import type { SyncResult } from './sync-runner.js';
import { pollLockKey } from './lock-keys.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Casts OAuthCredentialBlob to the generic Record the Piece interface expects.
 * Centralised here so any future Piece interface change only needs one update.
 */
function toCredentialsRecord(
  credentials: OAuthCredentialBlob,
): Record<string, unknown> {
  return credentials as unknown as Record<string, unknown>;
}

/** Starting high-water mark for a stream (before any pages are processed). */
function initialHwm(
  descriptor: StreamDescriptor,
  bookmark: StreamBookmark | undefined,
): string {
  if (bookmark) return String(bookmark.replication_key_value);
  const type = descriptor.replicationKeyType ?? 'opaque';
  if (type === 'numeric') return '0';
  if (type === 'timestamp') return new Date(0).toISOString();
  return '';
}

// ---------------------------------------------------------------------------
// Runtime schema for the state document stored in sync_cursors.state_document.
// Validates on read so a corrupt or migrated row never silently propagates bad
// state through the poll pipeline.
// ---------------------------------------------------------------------------

const StreamBookmarkSchema = z.object({
  replication_key: z.string(),
  replication_key_value: z.union([z.string(), z.number()]),
  replication_key_type: z.enum(['timestamp', 'numeric', 'opaque']),
  offset: z.record(z.string(), z.unknown()).optional(),
});

const SyncStateDocumentSchema = z.object({
  bookmarks: z.record(z.string(), StreamBookmarkSchema).default({}),
  versions: z.record(z.string(), z.number()).default({}),
  currently_syncing: z.string().nullable().default(null),
});

// ---------------------------------------------------------------------------

/**
 * Returns a log-safe representation of the high-water mark.
 * Opaque cursors may contain vendor-issued tokens or internal identifiers
 * that must not appear in logs; all other key types are safe to print verbatim.
 */
function safeHwm(hwm: string, keyType: string): string {
  return keyType === 'opaque' ? '[REDACTED]' : hwm;
}

// ---------------------------------------------------------------------------

/**
 * PollSyncRunner — real Singer-style poll pipeline (T030).
 *
 * For each stitch execution:
 *   1. Load stitch + source connection from DB.
 *   2. Obtain valid credentials via TokenManagerService (handles token refresh).
 *   3. Resolve the connector piece from the registry.
 *   4. Call piece.describeStreams() to get the StreamDescriptor for sourceObject.
 *   5. Acquire a Redis NX lock per stream
 *      (TTL = max(syncIntervalMinutes × 2 × 60 000 ms, 5 × 60 000 ms)).
 *      Skip the stream and return { status: 'skipped' } if the lock is held.
 *      Renew the lock before each page so long-running paginations do not
 *      expire mid-run; abort if the lock has been stolen.
 *   6. Detect crash-resume: if state_document.currently_syncing is set, the
 *      previous run crashed mid-pagination — resume from bookmark.offset.
 *   7. Paginate piece.poll() with CursorManagerService tracking the HWM.
 *      Write an intermediate checkpoint every checkpointInterval pages.
 *   8. Write the final checkpoint (clear currently_syncing + offset).
 *   9. Update integration_stitch.last_scheduled_at.
 */
@Injectable()
export class ConnectionSyncRunner {
  private readonly logger = new Logger(ConnectionSyncRunner.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly tokenManager: TokenManagerService,
    private readonly pieceRegistry: PieceRegistryService,
    private readonly cursorManager: CursorManagerService,
    private readonly storageResolver: StorageResolverService,
  ) {}

  // ── Public entry point ────────────────────────────────────────────────────

  async run(connectionId: string, objectType?: string): Promise<SyncResult> {
    const conn = await this.loadConnection(connectionId);

    // Obtain valid credentials for the connection
    const credentials =
      await this.tokenManager.getValidCredentials(connectionId);

    // Resolve the piece
    const piece = this.resolvePiece(conn.appName);

    // Get ALL streams for the connection if objectType is not provided
    let streams: StreamDescriptor[] = [];
    if (objectType) {
      streams = [await this.resolveDescriptor(piece, objectType, credentials)];
    } else {
      if (typeof piece.describeStreams === 'function') {
        streams = await piece.describeStreams(toCredentialsRecord(credentials));
      } else {
        // If describeStreams is not supported, we can't reliably sync "all" streams.
        this.logger.error(
          `piece ${conn.appName} does not support describeStreams and no objectType was provided`,
          { connectionId, appName: conn.appName },
        );
        return {
          connectionId,
          status: 'failed',
          streamResults: [],
        };
      }
    }

    const streamResults: StreamResult[] = [];
    let hasFailures = false;

    // Run poll loop for all streams sequentially to avoid hammering the vendor API
    for (const descriptor of streams) {
      const result = await this.pollStream(
        connectionId,
        conn.orgId,
        60,
        descriptor,
        piece,
        credentials,
      );
      streamResults.push(result);
      if (result.status === 'failed') hasFailures = true;
    }

    return {
      connectionId,
      status: hasFailures ? 'failed' : 'succeeded',
      streamResults,
    };
  }

  async fetchRecords(
    connectionId: string,
    objectType: string,
    recordIds: string[],
  ): Promise<SyncResult> {
    const conn = await this.loadConnection(connectionId);
    const credentials =
      await this.tokenManager.getValidCredentials(connectionId);
    const piece = this.resolvePiece(conn.appName);

    if (typeof piece.executeFetch !== 'function') {
      throw new BadRequestException(
        `Piece "${conn.appName}" does not support executeFetch`,
      );
    }

    const tenantDb = await this.dbManager.getTenantDb(conn.orgId);

    const fetches = recordIds.map(async (recordId) => {
      try {
        const record = await piece.executeFetch!(
          objectType,
          recordId,
          toCredentialsRecord(credentials),
        );
        return record ? { data: record, replicationKeyValue: recordId } : null;
      } catch (err) {
        this.logger.error(
          `Failed to fetch record ${recordId} from ${objectType}: ${err}`,
        );
        return null;
      }
    });

    const results = await Promise.all(fetches);
    const validRecords = results.filter(
      (
        r,
      ): r is { data: Record<string, unknown>; replicationKeyValue: string } =>
        r !== null,
    );

    if (validRecords.length === 0) {
      throw new NotFoundException(
        `No records found for the provided IDs in ${objectType}`,
      );
    }

    // Insert to inbound gateway using existing batching logic
    const inserted = await this.insertGatewayBatch(
      tenantDb,
      connectionId,
      objectType,
      validRecords,
    );

    if (inserted < validRecords.length) {
      this.logger.warn(
        `Fetched ${validRecords.length} records but only ${inserted} were inserted into the gateway (some may already exist with identical hash).`,
      );
    }

    return {
      connectionId,
      status: 'succeeded',
      streamResults: [
        {
          streamName: objectType,
          recordsIngested: inserted,
          status: 'succeeded',
        },
      ],
    };
  }

  // ── Per-stream poll ───────────────────────────────────────────────────────

  private async pollStream(
    connectionId: string,
    orgId: string,
    syncIntervalMinutes: number,
    descriptor: StreamDescriptor,
    piece: Piece,
    credentials: OAuthCredentialBlob,
  ): Promise<StreamResult> {
    const key = pollLockKey(connectionId, descriptor.streamName);
    // Use 2× the sync interval as the lock TTL so that a slow poll run that
    // approaches the full interval does not lose the lock mid-pagination.
    // Floor at 5 minutes to protect very short intervals.
    const ttlMs = Math.max(syncIntervalMinutes * 2 * 60_000, 5 * 60_000);

    // Acquire Redis NX lock — skip stream if already held by another worker.
    const lockToken = await this.acquireLock(key, ttlMs);
    if (!lockToken) {
      this.logger.debug(
        `Lock unavailable for stream "${descriptor.streamName}" on connection ${connectionId} — skipping`,
      );
      return {
        streamName: descriptor.streamName,
        recordsIngested: 0,
        status: 'skipped',
      };
    }

    try {
      return await this.runPollLoop(
        connectionId,
        orgId,
        descriptor,
        piece,
        credentials,
        key,
        lockToken,
        ttlMs,
      );
    } catch (err) {
      const error =
        err instanceof Error ? err.stack || err.message : String(err);
      this.logger.error(
        `Poll loop failed for stream "${descriptor.streamName}" on connection ${connectionId}: ${error}`,
      );
      return {
        streamName: descriptor.streamName,
        recordsIngested: 0,
        status: 'failed',
        error,
      };
    } finally {
      await this.releaseLock(key, lockToken);
    }
  }

  // ── Poll loop (lock already held) ────────────────────────────────────────

  private async runPollLoop(
    connectionId: string,
    orgId: string,
    descriptor: StreamDescriptor,
    piece: Piece,
    credentials: OAuthCredentialBlob,
    lockKey: string,
    lockToken: string,
    ttlMs: number,
  ): Promise<StreamResult> {
    const { streamName } = descriptor;

    const tenantDb = await this.dbManager.getTenantDb(orgId);

    // Read or initialise the Singer-style state document for this stream.
    const stateDoc = await this.readOrCreateStateDoc(
      tenantDb,
      connectionId,
      streamName,
    );
    const bookmark = stateDoc.bookmarks[streamName];

    // Crash-resume: if currently_syncing is set, the last run crashed after
    // writing at least one intermediate checkpoint — resume from bookmark.offset.
    if (stateDoc.currently_syncing === streamName && bookmark?.offset) {
      this.logger.warn(
        `Crash-resume detected for stream "${streamName}" on connection ${connectionId} — resuming from page offset`,
      );
    }

    // Mark run as in-progress before the first page so a crash is detectable.
    stateDoc.currently_syncing = streamName;
    await this.writeStateDoc(tenantDb, connectionId, streamName, stateDoc);

    const window = this.cursorManager.calculateWindow(bookmark, descriptor);
    const keyType = descriptor.replicationKeyType ?? 'opaque';

    let hwm = initialHwm(descriptor, bookmark);
    let nextCursor: Record<string, unknown> | undefined = bookmark?.offset;
    let pageCount = 0;
    let recordsIngested = 0;

    while (true) {
      // Renew the lock before each page so a slow multi-page run does not lose
      // ownership mid-pagination. Abort immediately if another worker has taken
      // the lock (renewal returns false), which prevents concurrent writes to
      // connection_sync_cursors for the same stream.
      const renewed = await this.renewLock(lockKey, lockToken, ttlMs);
      if (!renewed) {
        throw new Error(
          `Lock stolen for stream "${streamName}" on connection ${connectionId} — aborting to prevent concurrent writes`,
        );
      }

      const page = await piece.poll!(
        toCredentialsRecord(credentials),
        streamName,
        window,
        nextCursor,
      );

      this.logger.log(
        `[ConnectionSyncRunner.runPollLoop] Polled page: ${page.records.length} records. hasNextPage: ${!!page.nextPageCursor}`,
      );

      if (page.records.length > 0) {
        hwm = this.cursorManager.trackHighWaterMark(page.records, hwm, keyType);

        // Insert records into inbound_gateway in batches
        try {
          const insertedCount = await this.insertGatewayBatch(
            tenantDb,
            connectionId,
            streamName,
            page.records,
          );
          recordsIngested += insertedCount;
        } catch (e) {
          this.logger.error(`Failed to insert batch: ${e}`);
          throw e; // Bubble up the actual insertion error to the UI
        }
        this.logger.log(
          `[ConnectionSyncRunner.runPollLoop] After loop, recordsIngested is now: ${recordsIngested}`,
        );
      }

      pageCount++;
      nextCursor = page.nextPageCursor;

      // Intermediate checkpoint — persist progress so a crash can resume here.
      if (pageCount % this.cursorManager.checkpointInterval === 0) {
        stateDoc.bookmarks[streamName] = this.buildBookmark(
          descriptor,
          hwm,
          nextCursor,
        );
        await this.writeStateDoc(tenantDb, connectionId, streamName, stateDoc);
        this.logger.debug(
          `Intermediate checkpoint at page ${pageCount} for stream "${streamName}" (hwm=${safeHwm(hwm, keyType)})`,
        );
      }

      if (!nextCursor) break;
    }

    // Final checkpoint — clear currently_syncing and the pagination offset.
    stateDoc.bookmarks[streamName] = this.buildBookmark(
      descriptor,
      hwm,
      undefined,
    );
    stateDoc.currently_syncing = null;
    await this.writeStateDoc(tenantDb, connectionId, streamName, stateDoc);

    this.logger.log(
      `Stream "${streamName}" completed: ${recordsIngested} records ingested over ${pageCount} page(s), hwm=${safeHwm(hwm, keyType)}`,
    );

    return { streamName, recordsIngested, status: 'succeeded' };
  }

  // ── DB helpers ────────────────────────────────────────────────────────────

  private async loadConnection(dataSourceId: string) {
    const [conn] = await this.db
      .select({
        id: dataSources.id,
        appName: dataSources.appName,
        orgId: dataSources.tenantId,
        metadata: dataSources.metadata,
      })
      .from(dataSources)
      .where(eq(dataSources.id, dataSourceId))
      .limit(1);
    if (!conn)
      throw new NotFoundException(`Data source not found: ${dataSourceId}`);
    return conn;
  }

  private async readOrCreateStateDoc(
    tenantDb: DrizzleDb,
    connectionId: string,
    streamName: string,
  ): Promise<SyncStateDocument> {
    const [row] = await tenantDb
      .select({ stateDocument: syncCursors.stateDocument })
      .from(syncCursors)
      .where(
        and(
          eq(syncCursors.dataSourceId, connectionId),
          eq(syncCursors.streamName, streamName),
        ),
      )
      .limit(1);

    if (row) {
      const parsed = SyncStateDocumentSchema.safeParse(row.stateDocument);
      if (!parsed.success) {
        this.logger.warn(
          `Corrupt state document for connection ${connectionId} / stream "${streamName}" — resetting to default. ` +
            `Validation errors: ${parsed.error.message}`,
        );
        return { bookmarks: {}, versions: {}, currently_syncing: null };
      }
      return parsed.data;
    }

    // First run — initialise with the default SyncStateDocument shape.
    return { bookmarks: {}, versions: {}, currently_syncing: null };
  }

  private async writeStateDoc(
    tenantDb: DrizzleDb,
    connectionId: string,
    streamName: string,
    stateDoc: SyncStateDocument,
  ): Promise<void> {
    await tenantDb
      .insert(syncCursors)
      .values({
        dataSourceId: connectionId,
        streamName,
        stateDocument: stateDoc,
      })
      .onConflictDoUpdate({
        target: [syncCursors.dataSourceId, syncCursors.streamName],
        set: { stateDocument: stateDoc, updatedAt: new Date() },
      });
  }

  // ── Piece resolution ──────────────────────────────────────────────────────

  private resolvePiece(appName: string): Piece {
    const piece = this.pieceRegistry.getPiece(appName);
    if (!piece) {
      throw new BadRequestException(`Piece not registered: "${appName}"`);
    }
    if (typeof piece.poll !== 'function') {
      throw new BadRequestException(
        `Piece "${appName}" does not support polling (no poll() method)`,
      );
    }
    return piece;
  }

  private async resolveDescriptor(
    piece: Piece,
    sourceObject: string,
    credentials: OAuthCredentialBlob,
  ): Promise<StreamDescriptor> {
    if (typeof piece.describeStreams === 'function') {
      const streams = await piece.describeStreams(
        toCredentialsRecord(credentials),
      );
      const match = streams.find((s) => s.streamName === sourceObject);
      if (match) return match;
      this.logger.warn(
        `describeStreams() did not return a descriptor for "${sourceObject}" — using FULL_TABLE fallback`,
      );
    }

    // Fallback: treat the sourceObject as a FULL_TABLE stream with no replication key.
    //
    // CONNECTOR IMPLEMENTERS: if the source object does not have an "id" field
    // (which is the default deduplication key used here), set the env var
    // FALLBACK_KEY_PROPERTIES to a comma-separated list of field names that
    // uniquely identify records for this deployment (e.g. "externalId,type").
    // Alternatively, implement piece.describeStreams() so the correct
    // keyProperties are returned without relying on this fallback.
    return {
      streamName: sourceObject,
      replicationMethod: 'FULL_TABLE',
      keyProperties: this.fallbackKeyProperties(),
    };
  }

  /**
   * Returns the key properties to use for FULL_TABLE deduplication when the
   * connector piece does not provide a descriptor for the source object.
   *
   * Reads FALLBACK_KEY_PROPERTIES (comma-separated) from config; falls back to
   * ['id'] if the env var is absent or empty.
   */
  private fallbackKeyProperties(): [string, ...string[]] {
    const raw = this.config.get<string>('FALLBACK_KEY_PROPERTIES');
    if (raw) {
      const keys = raw
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      if (keys.length > 0) return keys as [string, ...string[]];
    }
    return ['id'];
  }

  // ── Bookmark helpers ──────────────────────────────────────────────────────

  private buildBookmark(
    descriptor: StreamDescriptor,
    hwm: string,
    offset: Record<string, unknown> | undefined,
  ): StreamBookmark {
    return {
      replication_key: descriptor.replicationKey ?? '',
      replication_key_value: hwm,
      replication_key_type: descriptor.replicationKeyType ?? 'opaque',
      ...(offset !== undefined ? { offset } : {}),
    };
  }

  // ── Redis lock helpers ────────────────────────────────────────────────────

  /**
   * Attempts to acquire a Redis NX lock.
   * Returns the unique lock token on success, or null if the lock is held.
   */
  private async acquireLock(
    key: string,
    ttlMs: number,
  ): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  /**
   * Extends the lock TTL if the caller still owns it.
   * Uses a Lua script for atomicity — prevents renewing another process's lock.
   * Returns true if the lease was extended, false if the lock has been stolen.
   */
  private async renewLock(
    key: string,
    token: string,
    ttlMs: number,
  ): Promise<boolean> {
    const lua = [
      "if redis.call('get', KEYS[1]) == ARGV[1] then",
      "  return redis.call('pexpire', KEYS[1], ARGV[2])",
      'else',
      '  return 0',
      'end',
    ].join('\n');
    const result = await this.redis.eval(lua, 1, key, token, String(ttlMs));
    return result === 1;
  }

  /**
   * Releases the lock only if the caller still owns it.
   * Uses a Lua script for atomicity — prevents releasing another process's lock
   * if the TTL expired between the check and the delete.
   */
  private async releaseLock(key: string, token: string): Promise<void> {
    const lua = [
      "if redis.call('get', KEYS[1]) == ARGV[1] then",
      "  return redis.call('del', KEYS[1])",
      'else',
      '  return 0',
      'end',
    ].join('\n');
    await this.redis.eval(lua, 1, key, token);
  }

  private async insertGatewayBatch(
    tenantDb: DrizzleDb,
    dataSourceId: string,
    objectType: string,
    records: any[],
  ): Promise<number> {
    const schemaName =
      await this.storageResolver.resolveSchemaName(dataSourceId);
    assertValidSchemaName(schemaName);

    if (!records || records.length === 0) return 0;

    let didInsert = 0;
    const { inboundGateway, inboundOutbox } = buildTenantSchema(schemaName);

    const valuesToInsert = records.map(
      (record: {
        replicationKeyValue?: string | number | boolean | null;
        data: unknown;
      }) => {
        const cursorValue =
          record.replicationKeyValue != null
            ? String(record.replicationKeyValue)
            : '';

        const payload = record.data as Record<string, unknown>;

        const payloadHash = createHash('sha256')
          .update(
            typeof payload === 'object' && payload !== null
              ? stringify(payload)
              : String(payload),
          )
          .digest('hex');

        // Extract the primary identifier of the record (e.g. Salesforce Id)
        let recordId = cursorValue || this.extractRecordCursor(payload);

        // If no deterministic ID exists, generate one from payload hash
        if (!recordId) {
          recordId = payloadHash.substring(0, 16);
        }

        const extReqId = `${objectType}-${recordId}-${payloadHash}`;

        return {
          traceId: randomUUID(),
          dataSourceId,
          extReqId,
          objectType,
          request: payload,
        };
      },
    );

    await tenantDb.transaction(async (tx) => {
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.identifier(schemaName)}`,
      );

      // Chunk the inserts to avoid hitting PG limits if the array is very large.
      const chunkSize = 200;
      for (let i = 0; i < valuesToInsert.length; i += chunkSize) {
        const chunk = valuesToInsert.slice(i, i + chunkSize);

        const result = await tx
          .insert(inboundGateway)
          .values(chunk)
          .onConflictDoNothing({
            target: [inboundGateway.dataSourceId, inboundGateway.extReqId],
            where: sql`ext_req_id IS NOT NULL`,
          })
          .returning({ traceId: inboundGateway.traceId });

        if (result.length > 0) {
          const outboxChunk = result.map((r) => ({
            traceId: r.traceId,
            dataSourceId,
          }));
          await tx
            .insert(inboundOutbox)
            .values(outboxChunk)
            .onConflictDoNothing({
              target: [inboundOutbox.traceId, inboundOutbox.dataSourceId],
            });
          didInsert += result.length;
        }
      }
    });

    return didInsert;
  }

  private extractRecordCursor(record: unknown): string {
    if (record !== null && typeof record === 'object') {
      const r = record as Record<string, unknown>;
      for (const key of [
        'Id',
        'id',
        'LastModifiedDate',
        '_cursor',
        'CreatedDate',
      ]) {
        if (typeof r[key] === 'string' && r[key]) return r[key];
      }
    }
    return ''; // Return empty string so the caller can fallback
  }
}

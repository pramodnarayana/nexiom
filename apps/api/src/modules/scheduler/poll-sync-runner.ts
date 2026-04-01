import {
  Injectable,
  Logger,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import type { DrizzleDb } from '@nexiom/database';
import {
  DATABASE_CONNECTION,
  integrationStitches,
  appConnections,
  syncCursors,
} from '@nexiom/database';
import { TokenManagerService } from '@nexiom/connectors';
import type { OAuthCredentialBlob } from '@nexiom/connectors';
import type { Piece } from '@nexiom/piece-framework';
import { REDIS_CLIENT, type Redis } from '@nexiom/cache';
import {
  CursorManagerService,
  type StreamBookmark,
  type SyncStateDocument,
  type StreamDescriptor,
  type StreamResult,
} from '@nexiom/engine';
import { PieceRegistryService } from '@nexiom/engine';
import { SyncRunner, type SyncResult } from './sync-runner.js';
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
  bookmarks: z.record(z.string(), StreamBookmarkSchema),
  versions: z.record(z.string(), z.number()),
  currently_syncing: z.string().nullable(),
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
export class PollSyncRunner extends SyncRunner {
  private readonly logger = new Logger(PollSyncRunner.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly tokenManager: TokenManagerService,
    private readonly pieceRegistry: PieceRegistryService,
    private readonly cursorManager: CursorManagerService,
  ) {
    super();
  }

  // ── Public entry point ────────────────────────────────────────────────────

  async run(stitchId: string): Promise<SyncResult> {
    // 1. Load stitch
    const stitch = await this.loadStitch(stitchId);

    // 2. Load connection (appName drives piece resolution)
    const connection = await this.loadConnection(stitch.srcConnectionId);

    // 3. Valid credentials (refreshes OAuth token if expired)
    const credentials = await this.tokenManager.getValidCredentials(
      stitch.srcConnectionId,
    );

    // 4. Resolve piece
    const piece = this.resolvePiece(connection.appName);

    // 5. Describe streams — find the descriptor for the configured sourceObject
    const descriptor = await this.resolveDescriptor(
      piece,
      stitch.sourceObject,
      credentials,
    );

    // 6. Poll the single stream
    const streamResult = await this.pollStream(
      stitchId,
      stitch.syncIntervalMinutes,
      descriptor,
      piece,
      credentials,
    );

    // 7. Update last_scheduled_at only when the stream was actually polled to completion.
    //    Skip and failed outcomes do not count as a completed sync.
    if (streamResult.status === 'succeeded') {
      await this.db
        .update(integrationStitches)
        .set({ lastScheduledAt: new Date() })
        .where(eq(integrationStitches.id, stitchId));
    }

    const topStatus =
      streamResult.status === 'failed'
        ? 'failed'
        : streamResult.status === 'skipped'
          ? 'skipped'
          : 'succeeded';

    return {
      stitchId,
      status: topStatus,
      streamResults: [streamResult],
    };
  }

  // ── Per-stream poll ───────────────────────────────────────────────────────

  private async pollStream(
    stitchId: string,
    syncIntervalMinutes: number,
    descriptor: StreamDescriptor,
    piece: Piece,
    credentials: OAuthCredentialBlob,
  ): Promise<StreamResult> {
    const key = pollLockKey(stitchId, descriptor.streamName);
    // Use 2× the sync interval as the lock TTL so that a slow poll run that
    // approaches the full interval does not lose the lock mid-pagination.
    // Floor at 5 minutes to protect very short intervals.
    const ttlMs = Math.max(syncIntervalMinutes * 2 * 60_000, 5 * 60_000);

    // Acquire Redis NX lock — skip stream if already held by another worker.
    const lockToken = await this.acquireLock(key, ttlMs);
    if (!lockToken) {
      this.logger.debug(
        `Lock unavailable for stream "${descriptor.streamName}" on stitch ${stitchId} — skipping`,
      );
      return {
        streamName: descriptor.streamName,
        recordsIngested: 0,
        status: 'skipped',
      };
    }

    try {
      return await this.runPollLoop(
        stitchId,
        descriptor,
        piece,
        credentials,
        key,
        lockToken,
        ttlMs,
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Poll loop failed for stream "${descriptor.streamName}" on stitch ${stitchId}: ${error}`,
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
    stitchId: string,
    descriptor: StreamDescriptor,
    piece: Piece,
    credentials: OAuthCredentialBlob,
    lockKey: string,
    lockToken: string,
    ttlMs: number,
  ): Promise<StreamResult> {
    const { streamName } = descriptor;

    // Read or initialise the Singer-style state document for this stream.
    const stateDoc = await this.readOrCreateStateDoc(stitchId, streamName);
    const bookmark = stateDoc.bookmarks[streamName];

    // Crash-resume: if currently_syncing is set, the last run crashed after
    // writing at least one intermediate checkpoint — resume from bookmark.offset.
    if (stateDoc.currently_syncing === streamName && bookmark?.offset) {
      this.logger.warn(
        `Crash-resume detected for stream "${streamName}" on stitch ${stitchId} — resuming from page offset`,
      );
    }

    // Mark run as in-progress before the first page so a crash is detectable.
    stateDoc.currently_syncing = streamName;
    await this.writeStateDoc(stitchId, streamName, stateDoc);

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
      // sync_cursors for the same stream.
      const renewed = await this.renewLock(lockKey, lockToken, ttlMs);
      if (!renewed) {
        throw new Error(
          `Lock stolen for stream "${streamName}" on stitch ${stitchId} — aborting to prevent concurrent writes`,
        );
      }

      const page = await piece.poll!(
        toCredentialsRecord(credentials),
        streamName,
        window,
        nextCursor,
      );

      if (page.records.length > 0) {
        hwm = this.cursorManager.trackHighWaterMark(page.records, hwm, keyType);
        recordsIngested += page.records.length;
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
        await this.writeStateDoc(stitchId, streamName, stateDoc);
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
    await this.writeStateDoc(stitchId, streamName, stateDoc);

    this.logger.log(
      `Stream "${streamName}" completed: ${recordsIngested} records ingested over ${pageCount} page(s), hwm=${safeHwm(hwm, keyType)}`,
    );

    return { streamName, recordsIngested, status: 'succeeded' };
  }

  // ── DB helpers ────────────────────────────────────────────────────────────

  private async loadStitch(stitchId: string) {
    const [stitch] = await this.db
      .select()
      .from(integrationStitches)
      .where(eq(integrationStitches.id, stitchId))
      .limit(1);
    if (!stitch) throw new NotFoundException(`Stitch not found: ${stitchId}`);
    return stitch;
  }

  private async loadConnection(connectionId: string) {
    const [conn] = await this.db
      .select({
        id: appConnections.id,
        appName: appConnections.appName,
      })
      .from(appConnections)
      .where(eq(appConnections.id, connectionId))
      .limit(1);
    if (!conn)
      throw new NotFoundException(`Connection not found: ${connectionId}`);
    return conn;
  }

  private async readOrCreateStateDoc(
    stitchId: string,
    streamName: string,
  ): Promise<SyncStateDocument> {
    const [row] = await this.db
      .select({ stateDocument: syncCursors.stateDocument })
      .from(syncCursors)
      .where(
        and(
          eq(syncCursors.stitchId, stitchId),
          eq(syncCursors.streamName, streamName),
        ),
      )
      .limit(1);

    if (row) {
      const parsed = SyncStateDocumentSchema.safeParse(row.stateDocument);
      if (!parsed.success) {
        this.logger.warn(
          `Corrupt state document for stitch ${stitchId} / stream "${streamName}" — resetting to default. ` +
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
    stitchId: string,
    streamName: string,
    stateDoc: SyncStateDocument,
  ): Promise<void> {
    await this.db
      .insert(syncCursors)
      .values({
        stitchId,
        streamName,
        stateDocument: stateDoc,
      })
      .onConflictDoUpdate({
        target: [syncCursors.stitchId, syncCursors.streamName],
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
}

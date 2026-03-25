import { Injectable, Logger, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import type { DrizzleDb } from '@nexiom/database';
import {
  DATABASE_CONNECTION,
  integrationStitches,
  appConnections,
  syncCursors,
} from '@nexiom/database';
import { TokenManagerService } from '@nexiom/connectors';
import type { Piece, OAuthCredentialBlob } from '@nexiom/connectors';
import { REDIS_CLIENT, type Redis } from '@nexiom/cache';
import {
  CursorManagerService,
  type StreamBookmark,
  type SyncStateDocument,
  type StreamDescriptor,
  type StreamResult,
} from '@nexiom/engine';
import { PieceRegistryService } from '../trigger/piece-registry.service.js';
import { SyncRunner, type SyncResult } from './sync-runner.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Redis key for a per-stream poll lock. */
function lockKey(stitchId: string, streamName: string): string {
  return `lock:poll:${stitchId}:${streamName}`;
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

/**
 * PollSyncRunner — real Singer-style poll pipeline (T030).
 *
 * For each stitch execution:
 *   1. Load stitch + source connection from DB.
 *   2. Obtain valid credentials via TokenManagerService (handles token refresh).
 *   3. Resolve the connector piece from the registry.
 *   4. Call piece.describeStreams() to get the StreamDescriptor for sourceObject.
 *   5. Acquire a Redis NX lock per stream (TTL = stitch interval).
 *      Skip the stream and return { status: 'skipped' } if the lock is held.
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
    const key = lockKey(stitchId, descriptor.streamName);
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
      return await this.runPollLoop(stitchId, descriptor, piece, credentials);
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
      const page = await piece.poll!(
        credentials as unknown as Record<string, unknown>,
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
          `Intermediate checkpoint at page ${pageCount} for stream "${streamName}" (hwm=${hwm})`,
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
      `Stream "${streamName}" completed: ${recordsIngested} records ingested over ${pageCount} page(s), hwm=${hwm}`,
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
    if (!stitch) throw new Error(`Stitch not found: ${stitchId}`);
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
    if (!conn) throw new Error(`Connection not found: ${connectionId}`);
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
      return row.stateDocument as SyncStateDocument;
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
        set: { stateDocument: stateDoc },
      });
  }

  // ── Piece resolution ──────────────────────────────────────────────────────

  private resolvePiece(appName: string): Piece {
    const piece = this.pieceRegistry.getPiece(appName);
    if (!piece) {
      throw new Error(`Piece not registered: "${appName}"`);
    }
    if (typeof piece.poll !== 'function') {
      throw new Error(
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
        credentials as unknown as Record<string, unknown>,
      );
      const match = streams.find((s) => s.streamName === sourceObject);
      if (match) return match;
      this.logger.warn(
        `describeStreams() did not return a descriptor for "${sourceObject}" — using FULL_TABLE fallback`,
      );
    }

    // Fallback: treat the sourceObject as a FULL_TABLE stream with no replication key.
    // 'id' is a safe sentinel — the piece controls which fields it actually uses.
    return {
      streamName: sourceObject,
      replicationMethod: 'FULL_TABLE',
      keyProperties: ['id'],
    };
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

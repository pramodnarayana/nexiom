import {
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  Logger,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { AuthContext, AuthGuard, type RequestAuthContext } from '@soopa/auth';
import { SystemAdminGuard } from '../identity/auth/system-admin.guard.js';
import { DATABASE_CONNECTION, syncCursors, dataSources } from '@soopa/database';
import type { DrizzleDb } from '@soopa/database';
import { REDIS_CLIENT, type Redis } from '@soopa/cache';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { pollLockKey } from './lock-keys.js';
import { computeCursorStaleness } from './cursor-staleness.js';

// TTL for the admin cursor-reset lock.  Must be long enough to cover the DB
// delete even under elevated database latency.  Matches the minimum floor used
// by PollSyncRunner (5 minutes) so that a concurrent poll that starts just
// after we acquire the lock cannot complete and reacquire before we release.
const ADMIN_RESET_LOCK_TTL_MS = 5 * 60_000;

// The legacy "stitches" URLs (admin/stitches/:id/cursor/:streamName and admin/stitches/:id/cursors)
// are intentionally preserved for backward compatibility. The underlying implementation
// operates on dataSources/connections and these routes remain unchanged to avoid breaking existing clients.
@UseGuards(AuthGuard, SystemAdminGuard)
@Controller('admin/stitches')
export class CursorResetController {
  private readonly logger = new Logger(CursorResetController.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Delete(':id/cursor/:streamName')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCursor(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('streamName') streamName: string,
    @AuthContext() ctx: RequestAuthContext,
  ): Promise<void> {
    if (!/^[\w.-]{1,200}$/.test(streamName)) {
      throw new BadRequestException('streamName contains invalid characters');
    }

    // Atomically acquire the per-stream poll lock (NX) for the duration of the
    // delete.  SET NX is a single atomic operation, so there is no TOCTOU window
    // between checking and holding the lock.  If the lock is already held by a
    // PollSyncRunner the NX fails and we return 409 — the admin retries once
    // the run completes.  Holding the lock during the delete prevents a new poll
    // from starting and immediately re-creating the cursor row we just removed.
    const lockKey = pollLockKey(id, streamName);
    // Use a unique token per acquisition so the compare-and-delete release
    // cannot accidentally free a lock held by a concurrent PollSyncRunner
    // that acquired it between our NX set and our eventual release.
    const lockToken = randomUUID();
    const acquired = await this.redis.set(
      lockKey,
      lockToken,
      'PX',
      ADMIN_RESET_LOCK_TTL_MS,
      'NX',
    );
    if (!acquired) {
      throw new ConflictException(
        `Stream "${streamName}" is currently being polled — retry after the run completes`,
      );
    }

    try {
      await this.db
        .delete(syncCursors)
        .where(
          and(
            eq(syncCursors.dataSourceId, id),
            eq(syncCursors.streamName, streamName),
          ),
        );
    } finally {
      // Compare-and-delete: only remove the lock if we still own it.
      // Prevents releasing a lock that expired and was re-acquired by a
      // PollSyncRunner during a slow DB delete.
      const lua = [
        "if redis.call('get', KEYS[1]) == ARGV[1] then",
        "  return redis.call('del', KEYS[1])",
        'else',
        '  return 0',
        'end',
      ].join('\n');
      await this.redis.eval(lua, 1, lockKey, lockToken);
    }

    // Use the stable internal principal ID rather than email (PII) in service
    // logs.  Audit trails that require email belong in a dedicated secure sink.
    this.logger.log(
      `Cursor reset: dataSourceId=${id}, streamName=${JSON.stringify(streamName)}, actorId=${ctx.user.id ?? '[unknown]'}`,
    );
  }

  @Get(':id/cursors')
  async listCursors(@Param('id', ParseUUIDPipe) id: string) {
    const [connection] = await this.db
      .select({
        syncIntervalMinutes: dataSources.syncIntervalMinutes,
        scheduleEnabled: dataSources.scheduleEnabled,
      })
      .from(dataSources)
      .where(eq(dataSources.id, id))
      .limit(1);

    if (!connection) {
      throw new NotFoundException(`Connection not found: ${id}`);
    }

    const rows = await this.db
      .select({
        id: syncCursors.id,
        dataSourceId: syncCursors.dataSourceId,
        streamName: syncCursors.streamName,
        createdAt: syncCursors.createdAt,
        updatedAt: syncCursors.updatedAt,
      })
      .from(syncCursors)
      .where(eq(syncCursors.dataSourceId, id));

    return computeCursorStaleness(rows, connection);
  }
}

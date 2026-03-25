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
import { AuthContext, AuthGuard, type RequestAuthContext } from '@nexiom/auth';
import { SystemAdminGuard } from '../identity/auth/system-admin.guard.js';
import {
  DATABASE_CONNECTION,
  syncCursors,
  integrationStitches,
} from '@nexiom/database';
import type { DrizzleDb } from '@nexiom/database';
import { REDIS_CLIENT, type Redis } from '@nexiom/cache';
import { eq, and } from 'drizzle-orm';
import { pollLockKey } from './lock-keys.js';

/** Short-lived TTL (ms) for the admin reset lock — long enough to cover the DB delete. */
const ADMIN_RESET_LOCK_TTL_MS = 5_000;

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
    const acquired = await this.redis.set(
      lockKey,
      'admin-reset',
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
            eq(syncCursors.stitchId, id),
            eq(syncCursors.streamName, streamName),
          ),
        );
    } finally {
      // Release immediately — we only needed the lock to prevent concurrent starts.
      await this.redis.del(lockKey);
    }

    this.logger.log(
      `Cursor reset: stitchId=${id}, streamName=${JSON.stringify(streamName)}, operator=${ctx.user.email}`,
    );
  }

  @Get(':id/cursors')
  async listCursors(@Param('id', ParseUUIDPipe) id: string) {
    const [stitch] = await this.db
      .select({
        syncIntervalMinutes: integrationStitches.syncIntervalMinutes,
        scheduleEnabled: integrationStitches.scheduleEnabled,
      })
      .from(integrationStitches)
      .where(eq(integrationStitches.id, id))
      .limit(1);

    if (!stitch) {
      throw new NotFoundException(`Stitch not found: ${id}`);
    }

    // Select only safe, non-sensitive columns.  stateDocument is intentionally
    // excluded — it may contain opaque vendor cursor tokens.
    const rows = await this.db
      .select({
        id: syncCursors.id,
        stitchId: syncCursors.stitchId,
        streamName: syncCursors.streamName,
        createdAt: syncCursors.createdAt,
        updatedAt: syncCursors.updatedAt,
      })
      .from(syncCursors)
      .where(eq(syncCursors.stitchId, id));

    const now = Date.now();
    const staleThresholdMs =
      stitch.syncIntervalMinutes > 0
        ? 2 * stitch.syncIntervalMinutes * 60_000
        : Number.POSITIVE_INFINITY;

    return rows.map((row) => {
      const ageMs = now - row.updatedAt.getTime();
      // Paused stitches are never stale — cursors are not expected to advance.
      const paused = !stitch.scheduleEnabled;
      return {
        ...row,
        ageMs,
        paused,
        stale: paused ? false : ageMs > staleThresholdMs,
      };
    });
  }
}

import {
  BadRequestException,
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
import { eq, and } from 'drizzle-orm';

@UseGuards(AuthGuard, SystemAdminGuard)
@Controller('admin/stitches')
export class CursorResetController {
  private readonly logger = new Logger(CursorResetController.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

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

    await this.db
      .delete(syncCursors)
      .where(
        and(
          eq(syncCursors.stitchId, id),
          eq(syncCursors.streamName, streamName),
        ),
      );

    this.logger.log(
      `Cursor reset: stitchId=${id}, streamName=${JSON.stringify(streamName)}, operator=${ctx.user.email}`,
    );
  }

  @Get(':id/cursors')
  async listCursors(@Param('id', ParseUUIDPipe) id: string) {
    const [stitch] = await this.db
      .select({ syncIntervalMinutes: integrationStitches.syncIntervalMinutes })
      .from(integrationStitches)
      .where(eq(integrationStitches.id, id))
      .limit(1);

    if (!stitch) {
      throw new NotFoundException(`Stitch not found: ${id}`);
    }

    const rows = await this.db
      .select()
      .from(syncCursors)
      .where(eq(syncCursors.stitchId, id));

    const now = Date.now();
    const staleThresholdMs =
      stitch.syncIntervalMinutes > 0
        ? 2 * stitch.syncIntervalMinutes * 60_000
        : Number.POSITIVE_INFINITY;

    return rows.map((row) => {
      const ageMs = now - row.updatedAt.getTime();
      return {
        ...row,
        ageMs,
        stale: ageMs > staleThresholdMs,
      };
    });
  }
}

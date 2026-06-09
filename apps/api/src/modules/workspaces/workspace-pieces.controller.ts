import {
  Controller,
  Post,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Inject,
  Body,
} from '@nestjs/common';
import { AuthGuard, PermissionsGuard, RequirePermission } from '@soopa/auth';
import {
  QUEUE_SERVICE,
  QueueName,
  type PluginInstallEvent,
  type IQueueService,
} from '@soopa/queue';
import { DATABASE_CONNECTION, workspacePieces, pieces } from '@soopa/database';
import type { DrizzleDb } from '@soopa/database';
import { eq, and } from 'drizzle-orm';
import { NotFoundException } from '@nestjs/common';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('workspaces/:workspaceId/pieces')
export class WorkspacePiecesController {
  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: IQueueService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  @Post(':pieceId/install')
  @RequirePermission('workspaces', 'manage')
  async installPiece(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('pieceId', ParseUUIDPipe) pieceId: string,
    @Body('version') version?: string,
  ) {
    // 1. Verify the piece exists globally
    const pieceResults = await this.db
      .select()
      .from(pieces)
      .where(eq(pieces.id, pieceId));
    if (pieceResults.length === 0) {
      throw new NotFoundException('Piece not found in global registry');
    }
    const piece = pieceResults[0];

    const requestedVersion = version || piece.version || 'latest';

    const existing = await this.db
      .select()
      .from(workspacePieces)
      .where(
        and(
          eq(workspacePieces.workspaceId, workspaceId),
          eq(workspacePieces.pieceId, pieceId),
        ),
      );

    if (existing.length > 0) {
      await this.db
        .update(workspacePieces)
        .set({ status: 'INSTALLING' })
        .where(eq(workspacePieces.id, existing[0].id));
    } else {
      await this.db
        .insert(workspacePieces)
        .values({ workspaceId, pieceId, status: 'INSTALLING' });
    }

    const installEvent: PluginInstallEvent = {
      packageName: piece.packageName,
      version: requestedVersion,
      workspaceId,
      pieceId,
      requestMetadata: {
        source: 'ui-install',
        webhookReceivedAt: new Date().toISOString(),
      },
    };
    await this.queueService.send(QueueName.PluginInstallQueue, installEvent);

    return { status: 'accepted', message: 'Installation queued' };
  }
}

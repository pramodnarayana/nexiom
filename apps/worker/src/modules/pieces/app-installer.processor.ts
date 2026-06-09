import { Injectable, Logger, OnModuleInit, Inject } from "@nestjs/common";
import {
  QUEUE_SERVICE,
  QueueName,
  type PluginInstallEvent,
  type IQueueService,
} from "@soopa/queue";
import { PluginManagerService } from "@soopa/piece-registry";
import { DATABASE_CONNECTION, workspacePieces } from "@soopa/database";
import type { DrizzleDb } from "@soopa/database";
import { eq, and } from "drizzle-orm";

@Injectable()
export class AppInstallerProcessor implements OnModuleInit {
  private readonly logger = new Logger(AppInstallerProcessor.name);

  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: IQueueService,
    private readonly pluginManager: PluginManagerService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  onModuleInit() {
    this.queueService.consume(
      QueueName.PluginInstallQueue,
      async (event: PluginInstallEvent) => {
        this.logger.log(
          `Processing PluginInstallEvent for ${event.packageName}@${event.version}`,
        );

        try {
          // 1. Download & Install the piece using the Registry manager
          const pluginInfo = await this.pluginManager.installPiece(
            event.packageName,
            event.version,
          );
          this.logger.log(
            `Installed ${event.packageName} v${pluginInfo.version} successfully.`,
          );

          // 2. Update the workspace installation record if this was a tenant-driven install
          if (event.workspaceId && event.pieceId) {
            await this.db
              .update(workspacePieces)
              .set({
                status: "INSTALLED",
                installedVersion: pluginInfo.version,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(workspacePieces.workspaceId, event.workspaceId),
                  eq(workspacePieces.pieceId, event.pieceId),
                ),
              );

            this.logger.log(
              `Marked workspace piece as INSTALLED for workspace ${event.workspaceId}`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Failed to process App Installation for ${event.packageName}`,
            error,
          );

          if (event.workspaceId && event.pieceId) {
            try {
              await this.db
                .update(workspacePieces)
                .set({ status: "FAILED", updatedAt: new Date() })
                .where(
                  and(
                    eq(workspacePieces.workspaceId, event.workspaceId),
                    eq(workspacePieces.pieceId, event.pieceId),
                  ),
                );
            } catch (dbErr) {
              this.logger.error(
                `Failed to mark workspace piece as FAILED`,
                dbErr,
              );
            }
          }
          throw error; // Re-throw to DLQ if max retries exceeded
        }
      },
    );
  }
}

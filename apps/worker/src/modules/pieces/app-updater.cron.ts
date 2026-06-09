import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  QUEUE_SERVICE,
  QueueName,
  type PluginInstallEvent,
  type IQueueService,
} from "@soopa/queue";
import { DATABASE_CONNECTION, workspacePieces, pieces } from "@soopa/database";
import type { DrizzleDb } from "@soopa/database";
import { eq } from "drizzle-orm";
import axios from "axios";
import { Inject } from "@nestjs/common";

@Injectable()
export class AppUpdaterCron {
  private readonly logger = new Logger(AppUpdaterCron.name);

  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: IQueueService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  /**
   * Runs every 12 hours. Scans installed pieces and polls NPM for newer versions.
   */
  @Cron(CronExpression.EVERY_12_HOURS)
  async checkUpdates() {
    this.logger.log("Running App Auto-Updater Cron Job...");

    try {
      // Fetch distinct installed pieces across all workspaces
      const installedApps = await this.db
        .selectDistinct({
          pieceId: workspacePieces.pieceId,
          packageName: pieces.packageName,
          currentVersion: workspacePieces.installedVersion,
          workspaceId: workspacePieces.workspaceId,
        })
        .from(workspacePieces)
        .innerJoin(pieces, eq(workspacePieces.pieceId, pieces.id));

      const registryCache = new Map<string, string>();

      for (const app of installedApps) {
        if (!app.currentVersion) continue;

        let latestVersion = registryCache.get(app.packageName);
        if (!latestVersion) {
          try {
            const response = await axios.get<{ version: string }>(
              `https://registry.npmjs.org/${app.packageName}/latest`,
              { timeout: 5000 },
            );
            latestVersion = response.data.version;
            if (latestVersion)
              registryCache.set(app.packageName, latestVersion);
          } catch (_err) {
            this.logger.warn(`Could not fetch NPM info for ${app.packageName}`);
            continue;
          }
        }

        if (latestVersion && this.isNewer(app.currentVersion, latestVersion)) {
          // As confirmed, we keep it simple: Auto-update everything in the background.
          // Send to install queue
          const installEvent: PluginInstallEvent = {
            packageName: app.packageName,
            version: latestVersion,
            workspaceId: app.workspaceId,
            pieceId: app.pieceId,
            requestMetadata: {
              source: "app-updater-cron",
              webhookReceivedAt: new Date().toISOString(),
            },
          };

          try {
            await this.queueService.send(
              QueueName.PluginInstallQueue,
              installEvent,
            );
            this.logger.log(
              `Enqueued auto-update for ${app.packageName} from ${app.currentVersion} to ${latestVersion} for workspace ${app.workspaceId}`,
            );
          } catch (queueError) {
            this.logger.error(
              `Failed to enqueue update for ${app.packageName} (workspace ${app.workspaceId})`,
              queueError,
            );
            // Continue processing other apps
          }
        }
      }
    } catch (error) {
      this.logger.error("Failed to run App Auto-Updater", error);
    }
  }

  /**
   * Extremely simple SemVer comparison
   * Returns true if remoteVersion > localVersion
   */
  private isNewer(localVersion: string, remoteVersion: string): boolean {
    const lParts = localVersion.split(".").map(Number);
    const rParts = remoteVersion.split(".").map(Number);

    for (let i = 0; i < 3; i++) {
      const l = lParts[i] || 0;
      const r = rParts[i] || 0;
      if (r > l) return true;
      if (r < l) return false;
    }
    return false;
  }
}

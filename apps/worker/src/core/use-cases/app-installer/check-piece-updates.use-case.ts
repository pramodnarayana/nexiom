import { Logger } from "@nestjs/common";
import { QueueName } from "@soopa/queue";
import type { QueuePublisherPort } from "../../ports/outbound/queue-publisher.port.js";
import type {
  PieceRegistryPort,
  WorkspacePiecesRepositoryPort,
} from "../../ports/outbound/app-installer-ports.js";

export class CheckPieceUpdatesUseCase {
  private readonly logger = new Logger(CheckPieceUpdatesUseCase.name);

  constructor(
    private readonly repository: WorkspacePiecesRepositoryPort,
    private readonly registry: PieceRegistryPort,
    private readonly queuePublisher: QueuePublisherPort,
  ) {}

  async execute(): Promise<void> {
    this.logger.log("Running App Auto-Updater Use Case...");

    const installedApps = await this.repository.getAllInstalledPieces();
    const registryCache = new Map<string, string>();

    for (const app of installedApps) {
      if (!app.currentVersion) continue;

      let latestVersion = registryCache.get(app.packageName);

      if (!latestVersion) {
        try {
          latestVersion = await this.registry.getLatestVersion(app.packageName);
          registryCache.set(app.packageName, latestVersion);
        } catch (_err) {
          this.logger.warn(`Could not fetch NPM info for ${app.packageName}`);
          continue;
        }
      }

      if (latestVersion && this.isNewer(app.currentVersion, latestVersion)) {
        try {
          await this.queuePublisher.send(QueueName.PluginInstallQueue, {
            packageName: app.packageName,
            version: latestVersion,
            workspaceId: app.workspaceId,
            pieceId: app.pieceId,
            requestMetadata: {
              source: "app-updater-cron",
              webhookReceivedAt: new Date().toISOString(),
            },
          });

          this.logger.log(
            `Enqueued auto-update for ${app.packageName} from ${app.currentVersion} to ${latestVersion} for workspace ${app.workspaceId}`,
          );
        } catch (queueError) {
          this.logger.error(
            `Failed to enqueue update for ${app.packageName} (workspace ${app.workspaceId})`,
            queueError,
          );
        }
      }
    }
  }

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

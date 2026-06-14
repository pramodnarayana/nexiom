import { QueueName } from "@soopa/queue";
import * as semver from "semver";
import type { QueuePublisherPort } from "../../ports/outbound/queue-publisher.port.js";
import type {
  PieceRegistryPort,
  GlobalPiecesRepositoryPort,
  LoggerPort,
} from "../../ports/outbound/app-installer-ports.js";

export class CheckPieceUpdatesUseCase {
  constructor(
    private readonly repository: GlobalPiecesRepositoryPort,
    private readonly registry: PieceRegistryPort,
    private readonly queuePublisher: QueuePublisherPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(): Promise<void> {
    this.logger.log("Running App Auto-Updater Use Case...");

    const installedApps = await this.repository.getAllGlobalPieces();
    const registryCache = new Map<string, string>();

    for (const app of installedApps) {
      if (!app.version) continue;

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

      if (latestVersion && this.isNewer(app.version, latestVersion)) {
        try {
          await this.queuePublisher.send(QueueName.PluginInstallQueue, {
            packageName: app.packageName,
            version: latestVersion,
            requestMetadata: {
              source: "app-updater-cron",
              webhookReceivedAt: new Date().toISOString(),
            },
          });

          this.logger.log(
            `Enqueued auto-update for ${app.packageName} from ${app.version} to ${latestVersion}`,
          );
        } catch (queueError) {
          this.logger.error(
            `Failed to enqueue update for ${app.packageName}`,
            queueError instanceof Error ? queueError.stack : String(queueError),
          );
        }
      }
    }
  }

  private isNewer(localVersion: string, remoteVersion: string): boolean {
    try {
      const parsedLocal = semver.valid(localVersion);
      const parsedRemote = semver.valid(remoteVersion);

      if (!parsedLocal || !parsedRemote) {
        return remoteVersion > localVersion;
      }

      return semver.gt(parsedRemote, parsedLocal);
    } catch (_err) {
      return remoteVersion > localVersion;
    }
  }
}

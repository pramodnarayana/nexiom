import type {
  PieceRegistryPort,
  GlobalPiecesRepositoryPort,
  LoggerPort,
  SystemEventPubSubPort,
} from "../../ports/outbound/app-installer-ports.js";
import { extractPieceMetadata } from "@soopa/piece-registry";

export interface InstallPieceCommand {
  packageName: string;
  version: string;
  // Kept for backward compatibility with old events in the queue
  workspaceId?: string;
  pieceId?: string;
}

export class InstallPieceUseCase {
  constructor(
    private readonly registry: PieceRegistryPort,
    private readonly repository: GlobalPiecesRepositoryPort,
    private readonly pubSub: SystemEventPubSubPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(command: InstallPieceCommand): Promise<void> {
    this.logger.log(
      `Processing PluginInstallEvent for ${command.packageName}@${command.version}`,
    );

    let pluginInfo;
    try {
      // 1. Download to worker disk cache and extract metadata
      pluginInfo = await this.registry.installPiece(
        command.packageName,
        command.version,
      );

      this.logger.log(
        `Installed ${command.packageName} v${pluginInfo.version} successfully.`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to install ${command.packageName} — ${reason}`);
      throw error;
    }

    // 2. Auto-Register globally
    try {
      const piece = extractPieceMetadata(pluginInfo.moduleExports);

      if (!piece) {
        throw new Error(
          `Could not find exported piece object in ${command.packageName} - piece is missing required name or displayName fields`,
        );
      }

      await this.repository.upsertPiece({
        ...piece,
        packageName: command.packageName,
        version: pluginInfo.version,
      });

      this.logger.log(`Auto-registered global piece: ${piece.name}`);

      await this.pubSub.publishSystemEvent("system:plugins:reloaded", {
        packageName: command.packageName,
        version: pluginInfo.version,
      });
      this.logger.log(
        `Broadcasted system:plugins:reloaded event for ${command.packageName}`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to auto-register global piece ${command.packageName} — ${reason}`,
      );
      throw error;
    }
  }
}

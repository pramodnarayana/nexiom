import { Logger } from "@nestjs/common";
import type {
  PieceRegistryPort,
  WorkspacePiecesRepositoryPort,
} from "../../ports/outbound/app-installer-ports.js";

export interface InstallPieceCommand {
  packageName: string;
  version: string;
  workspaceId?: string;
  pieceId?: string;
}

export class InstallPieceUseCase {
  private readonly logger = new Logger(InstallPieceUseCase.name);

  constructor(
    private readonly registry: PieceRegistryPort,
    private readonly repository: WorkspacePiecesRepositoryPort,
  ) {}

  async execute(command: InstallPieceCommand): Promise<void> {
    this.logger.log(
      `Processing PluginInstallEvent for ${command.packageName}@${command.version}`,
    );

    let pluginInfo;
    try {
      pluginInfo = await this.registry.installPiece(
        command.packageName,
        command.version,
      );

      this.logger.log(
        `Installed ${command.packageName} v${pluginInfo.version} successfully.`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to install ${command.packageName}`,
        error,
      );

      if (command.workspaceId && command.pieceId) {
        try {
          await this.repository.markFailed(
            command.workspaceId,
            command.pieceId,
          );
        } catch (dbErr) {
          this.logger.error(`Failed to mark workspace piece as FAILED`, dbErr);
        }
      }

      throw error;
    }

    if (command.workspaceId && command.pieceId) {
      try {
        await this.repository.markInstalled(
          command.workspaceId,
          command.pieceId,
          pluginInfo.version,
        );

        this.logger.log(
          `Marked workspace piece as INSTALLED for workspace ${command.workspaceId}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to persist INSTALLED status for ${command.packageName}`,
          error,
        );
        // Do NOT call markFailed here - installation succeeded
      }
    }
  }
}

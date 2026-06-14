import type {
  PieceRegistryPort,
  GlobalPiecesRepositoryPort,
  LoggerPort,
} from "../../ports/outbound/app-installer-ports.js";

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
    private readonly logger: LoggerPort,
  ) {}

  async execute(command: InstallPieceCommand): Promise<void> {
    this.logger.log(
      `Processing PluginInstallEvent for ${command.packageName}@${command.version}`,
    );

    let pluginInfo;
    try {
      // 1. Download to worker disk cache
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

    // 2. Extract metadata and Auto-Register globally
    try {
      const moduleExports = await this.registry.requirePiece(
        command.packageName,
      );
      let piece = moduleExports.piece as Record<string, unknown> | undefined;

      let registerFn = moduleExports.register;
      if (
        typeof registerFn !== "function" &&
        moduleExports.default &&
        typeof (moduleExports.default as Record<string, unknown>).register ===
          "function"
      ) {
        registerFn = (moduleExports.default as Record<string, unknown>)
          .register;
      }

      if (!piece && typeof registerFn === "function") {
        piece = (registerFn as () => Record<string, unknown>)();
      }

      if (!piece && moduleExports.default) {
        piece = moduleExports.default as Record<string, unknown>;
      }

      if (
        !piece ||
        typeof piece.name !== "string" ||
        typeof piece.displayName !== "string"
      ) {
        throw new Error(
          `Could not find exported piece object in ${command.packageName} - piece is missing required name or displayName fields`,
        );
      }

      await this.repository.upsertPiece({
        name: piece.name,
        displayName: piece.displayName,
        logoUrl: typeof piece.logoUrl === "string" ? piece.logoUrl : undefined,
        description:
          typeof piece.description === "string" ? piece.description : undefined,
        categories:
          Array.isArray(piece.categories) &&
          piece.categories.every((c) => typeof c === "string")
            ? piece.categories
            : undefined,
        authType:
          piece.auth && typeof piece.auth === "object" && "type" in piece.auth
            ? (piece.auth.type as string)
            : undefined,
        authSchema:
          piece.auth && typeof piece.auth === "object" && "props" in piece.auth
            ? (piece.auth.props as Record<string, unknown>)
            : undefined,
        aliases:
          Array.isArray(piece.aliases) &&
          piece.aliases.every(
            (a) => typeof a === "object" && a !== null && !Array.isArray(a),
          )
            ? piece.aliases
            : undefined,
        packageName: command.packageName,
        version: pluginInfo.version,
      });

      this.logger.log(`Auto-registered global piece: ${piece.name}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to auto-register global piece ${command.packageName} — ${reason}`,
      );
      throw error;
    }
  }
}

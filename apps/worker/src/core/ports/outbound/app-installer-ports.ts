export interface InstalledPieceInfo {
  workspaceId: string;
  pieceId: string;
  packageName: string;
  currentVersion: string;
}

export interface PieceMetadata {
  name: string;
  displayName: string;
  logoUrl?: string;
  description?: string;
  categories?: string[];
  authType?: string;
  authSchema?: Record<string, unknown>;
  aliases?: Record<string, unknown>[];
  packageName: string;
  version: string;
}

export interface GlobalPiecesRepositoryPort {
  upsertPiece(metadata: PieceMetadata): Promise<void>;
  getAllGlobalPieces(): Promise<
    { id: string; packageName: string; version: string }[]
  >;
}

export interface PieceRegistryPort {
  installPiece(
    packageName: string,
    version: string,
  ): Promise<{
    version: string;
    location: string;
    moduleExports: Record<string, unknown>;
  }>;

  getLatestVersion(packageName: string): Promise<string>;
}

export interface SystemEventPubSubPort {
  publishSystemEvent(event: string, payload: unknown): Promise<void>;
}

export interface LoggerPort {
  log(message: string): void;
  warn(message: string): void;
  error(message: string, trace?: string): void;
  debug?(message: string): void;
}

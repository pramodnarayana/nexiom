export interface InstalledPieceInfo {
  workspaceId: string;
  pieceId: string;
  packageName: string;
  currentVersion: string;
}

export interface WorkspacePiecesRepositoryPort {
  markInstalled(
    workspaceId: string,
    pieceId: string,
    version: string,
  ): Promise<void>;

  markFailed(workspaceId: string, pieceId: string): Promise<void>;

  getAllInstalledPieces(): Promise<InstalledPieceInfo[]>;
}

export interface PieceRegistryPort {
  installPiece(
    packageName: string,
    version: string,
  ): Promise<{ version: string }>;

  getLatestVersion(packageName: string): Promise<string>;
}

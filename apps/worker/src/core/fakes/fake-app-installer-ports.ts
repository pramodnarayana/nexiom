/* eslint-disable @typescript-eslint/require-await */
import type {
  PieceRegistryPort,
  WorkspacePiecesRepositoryPort,
  InstalledPieceInfo,
} from "../ports/outbound/app-installer-ports.js";

export class FakeWorkspacePiecesRepository implements WorkspacePiecesRepositoryPort {
  public pieces = new Map<
    string,
    { status: string; version?: string; failed: boolean }
  >();
  public installedPieces: InstalledPieceInfo[] = [];

  async markInstalled(
    workspaceId: string,
    pieceId: string,
    version: string,
  ): Promise<void> {
    this.pieces.set(`${workspaceId}:${pieceId}`, {
      status: "INSTALLED",
      version,
      failed: false,
    });
  }

  async markFailed(workspaceId: string, pieceId: string): Promise<void> {
    this.pieces.set(`${workspaceId}:${pieceId}`, {
      status: "FAILED",
      failed: true,
    });
  }

  async getAllInstalledPieces(): Promise<InstalledPieceInfo[]> {
    return this.installedPieces;
  }
}

export class FakePieceRegistry implements PieceRegistryPort {
  public shouldFail = false;
  public installed: { packageName: string; version: string }[] = [];
  public latestVersions = new Map<string, string>();

  async installPiece(
    packageName: string,
    version: string,
  ): Promise<{ version: string }> {
    if (this.shouldFail) {
      throw new Error(`Failed to install ${packageName}`);
    }
    this.installed.push({ packageName, version });
    return { version };
  }

  async getLatestVersion(packageName: string): Promise<string> {
    const version = this.latestVersions.get(packageName);
    if (!version) {
      throw new Error(`Package ${packageName} not found in registry`);
    }
    return version;
  }
}

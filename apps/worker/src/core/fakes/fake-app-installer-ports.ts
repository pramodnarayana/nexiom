/* eslint-disable @typescript-eslint/require-await */
import type {
  PieceRegistryPort,
  GlobalPiecesRepositoryPort,
  PieceMetadata,
  LoggerPort,
} from "../ports/outbound/app-installer-ports.js";

export class FakeGlobalPiecesRepository implements GlobalPiecesRepositoryPort {
  public pieces = new Map<string, PieceMetadata>();

  async upsertPiece(metadata: PieceMetadata): Promise<void> {
    this.pieces.set(metadata.name, metadata);
  }

  async getAllGlobalPieces(): Promise<
    { id: string; packageName: string; version: string }[]
  > {
    return Array.from(this.pieces.values()).map((p, i) => ({
      id: `piece-${i}`,
      packageName: p.packageName,
      version: p.version,
    }));
  }
}

export class FakePieceRegistry implements PieceRegistryPort {
  public shouldFail = false;
  public installed: { packageName: string; version: string }[] = [];
  public latestVersions = new Map<string, string>();
  public requireMocks = new Map<string, Record<string, unknown>>();

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

  async requirePiece(packageName: string): Promise<Record<string, unknown>> {
    const mock = this.requireMocks.get(packageName);
    if (!mock) {
      throw new Error(`Cannot require mock for ${packageName}`);
    }
    return mock;
  }
}

export class FakeLoggerPort implements LoggerPort {
  logs: string[] = [];
  warns: string[] = [];
  errors: { message: string; trace?: string }[] = [];

  log(message: string): void {
    this.logs.push(message);
  }
  warn(message: string): void {
    this.warns.push(message);
  }
  error(message: string, trace?: string): void {
    this.errors.push({ message, trace });
  }
  debug(message: string): void {
    this.logs.push(`[DEBUG] ${message}`);
  }
}

import { Injectable, Inject } from "@nestjs/common";
import { DATABASE_CONNECTION, workspacePieces, pieces } from "@soopa/database";
import type { DrizzleDb } from "@soopa/database";
import { eq, and } from "drizzle-orm";
import type {
  WorkspacePiecesRepositoryPort,
  InstalledPieceInfo,
} from "../../core/ports/outbound/app-installer-ports.js";

@Injectable()
export class DrizzleWorkspacePiecesRepositoryAdapter implements WorkspacePiecesRepositoryPort {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  async markInstalled(
    workspaceId: string,
    pieceId: string,
    version: string,
  ): Promise<void> {
    const result = await this.db
      .update(workspacePieces)
      .set({
        status: "INSTALLED",
        installedVersion: version,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workspacePieces.workspaceId, workspaceId),
          eq(workspacePieces.pieceId, pieceId),
        ),
      );

    if (result.rowCount === 0) {
      throw new Error(
        `No workspace piece found to mark installed for workspaceId=${workspaceId}, pieceId=${pieceId}`,
      );
    }
  }

  async markFailed(workspaceId: string, pieceId: string): Promise<void> {
    const result = await this.db
      .update(workspacePieces)
      .set({ status: "FAILED", updatedAt: new Date() })
      .where(
        and(
          eq(workspacePieces.workspaceId, workspaceId),
          eq(workspacePieces.pieceId, pieceId),
        ),
      );

    if (result.rowCount === 0) {
      throw new Error(
        `No workspace piece found to mark failed for workspaceId=${workspaceId}, pieceId=${pieceId}`,
      );
    }
  }

  async getAllInstalledPieces(): Promise<InstalledPieceInfo[]> {
    const apps = await this.db
      .selectDistinct({
        pieceId: workspacePieces.pieceId,
        packageName: pieces.packageName,
        currentVersion: workspacePieces.installedVersion,
        workspaceId: workspacePieces.workspaceId,
      })
      .from(workspacePieces)
      .innerJoin(pieces, eq(workspacePieces.pieceId, pieces.id))
      .where(eq(workspacePieces.status, "INSTALLED"));

    return apps.map((app) => ({
      ...app,
      currentVersion: app.currentVersion ?? "",
    }));
  }
}

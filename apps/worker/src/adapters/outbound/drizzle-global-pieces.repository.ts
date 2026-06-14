import { Injectable, Inject, Logger } from "@nestjs/common";
import { DATABASE_CONNECTION, pieces } from "@soopa/database";
import type { DrizzleDb } from "@soopa/database";
import type {
  GlobalPiecesRepositoryPort,
  PieceMetadata,
} from "../../core/ports/outbound/app-installer-ports.js";
import { sql } from "drizzle-orm";

@Injectable()
export class DrizzleGlobalPiecesRepositoryAdapter implements GlobalPiecesRepositoryPort {
  private readonly logger = new Logger(
    DrizzleGlobalPiecesRepositoryAdapter.name,
  );

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  async upsertPiece(metadata: PieceMetadata): Promise<void> {
    this.logger.debug(`Upserting global piece metadata for ${metadata.name}`);

    await this.db
      .insert(pieces)
      .values({
        name: metadata.name,
        displayName: metadata.displayName,
        logoUrl: metadata.logoUrl || null,
        description: metadata.description || null,
        categories: metadata.categories || [],
        authType: metadata.authType || null,
        authSchema: metadata.authSchema || null,
        aliases: metadata.aliases || [],
        packageName: metadata.packageName,
        version: metadata.version,
        enabled: true, // Auto-enable by default
      })
      .onConflictDoUpdate({
        target: pieces.name,
        set: {
          displayName: metadata.displayName,
          logoUrl: metadata.logoUrl || null,
          description: metadata.description || null,
          categories: metadata.categories || [],
          authType: metadata.authType || null,
          authSchema: metadata.authSchema || null,
          aliases: metadata.aliases || [],
          packageName: metadata.packageName,
          version: metadata.version,
          updatedAt: sql`now()`,
        },
      });
  }

  async getAllGlobalPieces(): Promise<
    { id: string; packageName: string; version: string }[]
  > {
    const results = await this.db
      .select({
        id: pieces.id,
        packageName: pieces.packageName,
        version: pieces.version,
      })
      .from(pieces)
      .where(sql`${pieces.enabled} = true`);

    return results;
  }
}

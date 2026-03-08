import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Piece } from '@nexiom/connectors';
import { pieces, type DrizzleDb } from '@nexiom/database';

/**
 * Loads enabled Pieces from the database and dynamically imports their packages.
 *
 * This is the ONLY place that performs dynamic imports. The interface it returns
 * (Piece[]) is identical to the old static array — so PieceRegistryService and
 * all consumers above it are completely unaffected.
 *
 * Path to Tier 4B (external npm registry):
 *   Replace the `await import(row.packageName)` line with an install-then-import
 *   step. Everything else in this file and above stays the same.
 */
@Injectable()
export class PieceLoaderService {
  private readonly logger = new Logger(PieceLoaderService.name);

  async loadEnabledPieces(db: DrizzleDb): Promise<Piece[]> {
    const rows = await db.select().from(pieces).where(eq(pieces.enabled, true));

    this.logger.log(
      `Found ${rows.length} enabled piece(s) in DB: ${rows.map((r) => r.name).join(', ')}`,
    );

    const loaded: Piece[] = [];

    for (const row of rows) {
      try {
        // Approach A: package is pre-installed in the monorepo.
        // Approach B: install from external registry here before importing.
        const mod = (await import(row.packageName)) as Record<string, unknown>;
        const piece = this.extractPiece(mod, row.name);
        if (piece) {
          loaded.push(piece);
        } else {
          this.logger.warn(
            `Package "${row.packageName}" has no valid Piece export — skipping.`,
          );
        }
      } catch (err) {
        this.logger.error(
          `Failed to import piece package "${row.packageName}": ${(err as Error).message}`,
        );
        // Non-fatal: log and continue so one broken piece doesn't kill the app.
      }
    }

    return loaded;
  }

  /**
   * Finds the first value in a module's exports that looks like a Piece.
   * Pieces have a `name`, `displayName`, and `triggers` property.
   */
  private extractPiece(
    mod: Record<string, unknown>,
    expectedName: string,
  ): Piece | null {
    for (const exported of Object.values(mod)) {
      if (this.isPiece(exported)) {
        if (exported.name !== expectedName) {
          this.logger.error(
            `Piece name mismatch: package registered as "${expectedName}" but exports name "${exported.name}". ` +
              `Skipping to prevent registration under wrong key.`,
          );
          return null;
        }
        return exported;
      }
    }
    return null;
  }

  private isPiece(value: unknown): value is Piece {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    return (
      typeof v['name'] === 'string' &&
      typeof v['displayName'] === 'string' &&
      typeof v['description'] === 'string' &&
      typeof v['logoUrl'] === 'string' &&
      typeof v['actions'] === 'object' &&
      v['actions'] !== null &&
      typeof v['triggers'] === 'object' &&
      v['triggers'] !== null
    );
  }
}

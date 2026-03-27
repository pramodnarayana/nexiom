import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Piece } from '@nexiom/connectors';
import { pieces, type DrizzleDb } from '@nexiom/database';

/**
 * Injection token for the host application's `import.meta.url`.
 * When provided, the loader uses it as the anchor for resolving piece
 * packages — this ensures correct resolution regardless of CWD.
 *
 * Register in PiecesModule.forRoot({ anchorUrl: import.meta.url })
 */
export const PIECE_LOADER_ANCHOR_URL = 'PIECE_LOADER_ANCHOR_URL';

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

  constructor(
    @Optional() @Inject(PIECE_LOADER_ANCHOR_URL) private readonly anchorUrl: string | null,
  ) {}

  async loadEnabledPieces(db: DrizzleDb): Promise<Piece[]> {
    const rows = await db.select({
      name: pieces.name,
      packageName: pieces.packageName,
      enabled: pieces.enabled
    }).from(pieces).where(eq(pieces.enabled, true));

    this.logger.log(
      `Found ${rows.length} enabled piece(s) in DB: ${rows.map(r => r.name).join(', ')}`,
    );

    const loaded: Piece[] = [];

    for (const row of rows) {
      try {
        // Resolve through the host application's module graph so pnpm strict
        // linking doesn't hide pieces that are installed in apps/api but
        // not declared as explicit deps of @nexiom/engine.
        //
        // Anchor precedence:
        //   1. PIECE_LOADER_ANCHOR_URL token (set by host via PiecesModule.forRoot)
        //      — most reliable: always the host's actual file path on disk.
        //   2. import.meta.url of this file inside the engine package
        //      — fallback: walks up to the monorepo root's node_modules.
        //   3. Bare specifier  (pnpm strict-mode fallback, may fail)
        let resolvedPath = row.packageName;
        try {
          const { createRequire } = await import('node:module');
          const { fileURLToPath, pathToFileURL } = await import('node:url');
          const anchor = this.anchorUrl ?? import.meta.url;
          const anchorFile = anchor.startsWith('file://')
            ? anchor
            : pathToFileURL(anchor).href;
          const hostRequire = createRequire(fileURLToPath(anchorFile));
          resolvedPath = pathToFileURL(hostRequire.resolve(row.packageName)).href;
        } catch {
          // Non-fatal: fall through to bare-specifier import below.
        }

        const mod = (await import(resolvedPath)) as Record<string, unknown>;
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

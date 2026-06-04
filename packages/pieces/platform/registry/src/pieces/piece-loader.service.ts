import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Piece } from '@soopa/piece-framework';
import { pieces, type DrizzleDb } from '@soopa/database';
import { PluginManagerService } from './plugin-manager.service.js';

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
    private readonly pluginManager: PluginManagerService,
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
        let mod: Record<string, unknown>;
        
        try {
          // --- ENTERPRISE STARTUP SYNCHRONIZATION ---
          // Ensure the plugin is downloaded locally to /opt/nexiom/plugins
          await this.pluginManager.ensurePiece(row.packageName, 'latest');
          
          // Dynamically load the piece from the plugin manager's disk cache
          mod = this.pluginManager.requirePiece(row.packageName) as Record<string, unknown>;
        } catch (downloadErr: any) {
          this.logger.warn(`Startup Sync failed for ${row.packageName} (${downloadErr.message}). Falling back to local workspace resolution...`);
          
          // --- LOCAL DEVELOPMENT FALLBACK ---
          // Allows `pnpm dev` to load unpublished pieces directly from the monorepo node_modules
          let resolvedPath = row.packageName;
          try {
            const { createRequire } = await import('node:module');
            const { fileURLToPath, pathToFileURL } = await import('node:url');
            const anchor = this.anchorUrl ?? import.meta.url;
            const anchorFile = anchor.startsWith('file://') ? anchor : pathToFileURL(anchor).href;
            const hostRequire = createRequire(fileURLToPath(anchorFile));
            resolvedPath = pathToFileURL(hostRequire.resolve(row.packageName)).href;
          } catch {
            // Non-fatal: fall through to bare-specifier import below.
          }
          
          mod = (await import(resolvedPath)) as Record<string, unknown>;
        }
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
      v['triggers'] !== null &&
      typeof v['auth'] === 'object' &&
      v['auth'] !== null &&
      Array.isArray(v['categories']) &&
      v['categories'].every(c => typeof c === 'string')
    );
  }
}

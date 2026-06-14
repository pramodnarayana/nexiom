import { Injectable, Logger, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Piece } from '@soopa/piece-framework';
import { pieces, type DrizzleDb } from '@soopa/database';
import { PIECE_RESOLVER, type IPieceResolver } from './piece-resolver.port.js';

/**
 * Loads enabled Pieces from the database and resolves their module exports.
 *
 * This is the ONLY place that calls IPieceResolver.resolve(). The interface it
 * returns (Piece[]) is identical regardless of resolver implementation, so
 * PieceRegistryService and all consumers above it are completely unaffected
 * by the production vs. development resolver choice.
 *
 * Path to Tier 4B (external npm registry):
 *   Replace ProductionPieceResolver with an install-then-resolve step.
 *   Everything in this file and above stays the same.
 */
@Injectable()
export class PieceLoaderService {
  private readonly logger = new Logger(PieceLoaderService.name);

  constructor(
    @Inject(PIECE_RESOLVER) private readonly resolver: IPieceResolver,
  ) {}

  async loadEnabledPieces(db: DrizzleDb): Promise<Piece[]> {
    const rows = await db
      .select({
        name: pieces.name,
        packageName: pieces.packageName,
        enabled: pieces.enabled,
      })
      .from(pieces)
      .where(eq(pieces.enabled, true));

    this.logger.log(
      `Found ${rows.length} enabled piece(s) in DB: ${rows.map((r) => r.name).join(', ')}`,
    );

    const loaded: Piece[] = [];

    for (const row of rows) {
      const piece = await this.loadSinglePiece(row.packageName, row.name);
      if (piece) {
        loaded.push(piece);
      }
    }

    return loaded;
  }

  /**
   * Resolves, validates, and extracts a single Piece from its package.
   * Returns null and logs on any failure so one broken piece never kills the boot sequence.
   */
  private async loadSinglePiece(
    packageName: string,
    expectedName: string,
  ): Promise<Piece | null> {
    try {
      let mod = await this.resolver.resolve(packageName);

      // Inversion of Control (IoC): Inject host APIs if the plugin exports a register function.
      let registerFn = mod.register;
      if (typeof registerFn !== 'function' && mod.default && typeof (mod.default as any).register === 'function') {
         registerFn = (mod.default as any).register;
      }

      if (typeof registerFn === 'function') {
        const registeredPiece = registerFn();
        if (this.isPiece(registeredPiece)) {
          // Wrap it so extractPiece finds it easily
          mod = { default: registeredPiece };
        } else {
          this.logger.warn(`Plugin ${packageName} exported register() but it did not return a valid Piece.`);
        }
      }

      const piece = this.extractPiece(mod, expectedName);
      if (!piece) {
        this.logger.warn(
          `Package "${packageName}" has no valid Piece export — skipping.`,
        );
      }
      return piece;
    } catch (err: any) {
      const msg = err && err.stack ? err.stack : String(err);
      this.logger.error(
        `Failed to import piece package "${packageName}": ${msg}`,
      );
      // Non-fatal: log and continue so one broken piece doesn't kill the app.
      return null;
    }
  }

  /**
   * Finds the first exported value that satisfies the Piece shape.
   * Returns null if no valid export exists or if the exported name mismatches
   * the DB-registered name (prevents registration under a wrong key).
   */
  private extractPiece(
    mod: Record<string, unknown>,
    expectedName: string,
  ): Piece | null {
    for (const exported of Object.values(mod)) {
      if (this.isPiece(exported)) {
        if (exported.name !== expectedName) {
          this.logger.error(
            `Piece name mismatch: package registered as "${expectedName}" but exports ` +
              `name "${exported.name}". Skipping to prevent registration under wrong key.`,
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
      v['categories'].every((c) => typeof c === 'string')
    );
  }
}

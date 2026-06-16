import { Injectable, Logger, Inject } from '@nestjs/common';
import type { Piece, Trigger } from '@soopa/piece-framework';

/** NestJS injection token for the list of registered Pieces. */
export const PIECES = 'PIECES';

/**
 * Generic in-memory piece registry.
 * Has no knowledge of specific integrations — pieces are injected via the PIECES token.
 * Register pieces in the module that provides this service.
 */
@Injectable()
export class PieceRegistryService {
  private readonly logger = new Logger(PieceRegistryService.name);
  private readonly registry: Map<string, Piece>;
  private readonly aliasToBaseName: Map<string, string>;

  constructor(@Inject(PIECES) pieces: Piece[]) {
    // Fail fast on duplicate piece names — silent Map overwrites would hide bugs.
    const seen = new Set<string>();
    this.aliasToBaseName = new Map();

    for (const piece of pieces) {
      if (seen.has(piece.name)) {
        const msg = `Duplicate piece name detected: "${piece.name}". Each piece must have a unique name.`;
        this.logger.error(msg);
        throw new Error(msg);
      }
      seen.add(piece.name);

      if (piece.aliases) {
          for (const alias of piece.aliases) {
              if (seen.has(alias.name)) {
                  throw new Error(`Duplicate alias name detected: "${alias.name}". Alias names must be globally unique.`);
              }
              seen.add(alias.name);
              this.aliasToBaseName.set(alias.name, piece.name);
          }
      }
    }

    this.registry = new Map(pieces.map((p) => [p.name, p]));
    this.logger.log(
      `Piece registry initialised with ${this.registry.size} piece(s) and ${this.aliasToBaseName.size} alias(es).`,
    );
  }

  /**
   * Returns the parent piece regardless of whether the requested appName is the parent itself or an alias.
   */
  getPiece(appName: string): Piece | undefined {
    const baseName = this.resolveBasePieceName(appName);
    return this.registry.get(baseName);
  }

  /**
   * Returns the true backend piece identifier for a given UI provider name.
   * If the name is an alias (e.g. 'salesforce_revenova'), returns 'salesforce'.
   * Otherwise, returns the name unchanged.
   */
  resolveBasePieceName(name: string): string {
    return this.aliasToBaseName.get(name) || name;
  }

  getTrigger(appName: string, triggerName: string): Trigger | undefined {
    return this.getPiece(appName)?.triggers[triggerName];
  }

  /**
   * Dynamically registers or updates a piece in the in-memory registry.
   * This is used by the hot-reloader to make new pieces available without restarting the process.
   */
  registerPiece(piece: Piece): void {
    // Validate piece name doesn't collide with existing aliases mapped to other pieces
    const baseForName = this.aliasToBaseName.get(piece.name);
    if (baseForName && baseForName !== piece.name) {
      throw new Error(`Name conflict: Piece name "${piece.name}" is already used as an alias for piece "${baseForName}"`);
    }

    // Validate new aliases don't collide with existing aliases mapped to other pieces
    if (piece.aliases) {
      for (const alias of piece.aliases) {
        const existingBaseName = this.aliasToBaseName.get(alias.name);
        if (existingBaseName && existingBaseName !== piece.name) {
          throw new Error(
            `Alias conflict: "${alias.name}" is already mapped to piece "${existingBaseName}", cannot map to "${piece.name}"`,
          );
        }
        if (this.registry.has(alias.name) && alias.name !== piece.name) {
          throw new Error(
            `Alias conflict: "${alias.name}" matches an existing piece name, cannot map to "${piece.name}"`,
          );
        }
      }
    }

    // All validations passed, mutate state
    this.registry.set(piece.name, piece);

    // Remove stale aliases from previous versions of this piece
    const aliasesToRemove: string[] = [];
    for (const [alias, baseName] of this.aliasToBaseName.entries()) {
      if (baseName === piece.name) {
        aliasesToRemove.push(alias);
      }
    }
    for (const alias of aliasesToRemove) {
      this.aliasToBaseName.delete(alias);
    }

    // Register new aliases
    if (piece.aliases) {
      for (const alias of piece.aliases) {
        this.aliasToBaseName.set(alias.name, piece.name);
      }
    }

    this.logger.log(`Hot-loaded piece schema into memory: ${piece.name}`);
  }

  getAllPieces(): Piece[] {
    return [...this.registry.values()];
  }
}

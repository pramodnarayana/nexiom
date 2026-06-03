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

  getAllPieces(): Piece[] {
    return [...this.registry.values()];
  }
}

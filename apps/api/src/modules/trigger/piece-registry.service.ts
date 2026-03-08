import { Injectable, Logger, Inject } from '@nestjs/common';
import type { Piece, Trigger } from '@nexiom/connectors';

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

  constructor(@Inject(PIECES) pieces: Piece[]) {
    // Fail fast on duplicate piece names — silent Map overwrites would hide bugs.
    const seen = new Set<string>();
    for (const piece of pieces) {
      if (seen.has(piece.name)) {
        const msg = `Duplicate piece name detected: "${piece.name}". Each piece must have a unique name.`;
        this.logger.error(msg);
        throw new Error(msg);
      }
      seen.add(piece.name);
    }

    this.registry = new Map(pieces.map((p) => [p.name, p]));
    this.logger.log(
      `Piece registry initialised with ${this.registry.size} piece(s): ${[...this.registry.keys()].join(', ')}`,
    );
  }

  getPiece(appName: string): Piece | undefined {
    return this.registry.get(appName);
  }

  getTrigger(appName: string, triggerName: string): Trigger | undefined {
    return this.getPiece(appName)?.triggers[triggerName];
  }

  getAllPieces(): Piece[] {
    return [...this.registry.values()];
  }
}

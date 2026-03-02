import { Injectable, Logger } from '@nestjs/common';
import type { Piece, Trigger } from '@nexiom/connections';
import { salesforcePiece } from '@nexiom/connections';

/**
 * In-memory piece registry — single source of truth for all registered Pieces.
 * Add new pieces to REGISTERED_PIECES; no database or config file required.
 */
const REGISTERED_PIECES: Piece[] = [salesforcePiece];

@Injectable()
export class PieceRegistryService {
  private readonly logger = new Logger(PieceRegistryService.name);
  private readonly registry: Map<string, Piece>;

  constructor() {
    this.registry = new Map(REGISTERED_PIECES.map((p) => [p.name, p]));
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

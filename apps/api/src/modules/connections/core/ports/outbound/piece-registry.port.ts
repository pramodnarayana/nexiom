import type { Piece } from '@soopa/piece-framework';

export interface PieceRegistryPort {
  /**
   * Returns the registered piece definition for the given provider name, or null if not found.
   */
  getPiece(providerName: string): Piece | null;
}

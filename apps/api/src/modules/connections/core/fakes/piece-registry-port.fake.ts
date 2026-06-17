import type { PieceRegistryPort } from '../ports/outbound/piece-registry.port.js';
import type { Piece } from '@soopa/piece-framework';

export class FakePieceRegistryPort implements PieceRegistryPort {
  public pieces = new Map<string, Piece>();

  getPiece(providerName: string): Piece | null {
    return this.pieces.get(providerName) || null;
  }

  // Helper method for tests to set up fake pieces
  addPiece(providerName: string, pieceData: Partial<Piece>): void {
    this.pieces.set(providerName, pieceData as Piece);
  }
}

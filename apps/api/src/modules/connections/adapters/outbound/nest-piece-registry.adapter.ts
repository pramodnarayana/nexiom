import { Injectable } from '@nestjs/common';
import type { PieceRegistryPort } from '../../core/ports/outbound/piece-registry.port.js';
import { PieceRegistryService } from '@soopa/piece-registry';
import type { Piece } from '@soopa/piece-framework';

@Injectable()
export class NestPieceRegistryAdapter implements PieceRegistryPort {
  constructor(private readonly pieceRegistryService: PieceRegistryService) {}

  getPiece(providerName: string): Piece | null {
    return this.pieceRegistryService.getPiece(providerName) ?? null;
  }
}

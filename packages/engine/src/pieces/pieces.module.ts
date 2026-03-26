import { Module } from '@nestjs/common';
import {
  PieceRegistryService,
  PIECES,
} from './piece-registry.service.js';
import { PieceLoaderService } from './piece-loader.service.js';
import { DATABASE_CONNECTION } from '@nexiom/database';
import type { DrizzleDb } from '@nexiom/database';
import type { Piece } from '@nexiom/connectors';

/**
 * Encapsulates piece registration. Any module that needs the registry imports this.
 *
 * Pieces are resolved at startup from the `pieces` DB table — no static imports, no
 * code changes required when adding or disabling integrations.
 */
@Module({
  imports: [],
  providers: [
    PieceLoaderService,
    {
      provide: PIECES,
      useFactory: async (
        db: DrizzleDb,
        loader: PieceLoaderService,
      ): Promise<Piece[]> => {
        return loader.loadEnabledPieces(db);
      },
      inject: [DATABASE_CONNECTION, PieceLoaderService],
    },
    PieceRegistryService,
  ],
  exports: [PieceRegistryService],
})
export class PiecesModule {}

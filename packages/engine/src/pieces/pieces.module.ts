import { DynamicModule, Module } from '@nestjs/common';
import {
  PieceRegistryService,
  PIECES,
} from './piece-registry.service.js';
import { PieceLoaderService, PIECE_LOADER_ANCHOR_URL } from './piece-loader.service.js';
import { DATABASE_CONNECTION } from '@nexiom/database';
import type { DrizzleDb } from '@nexiom/database';
import type { Piece } from '@nexiom/connectors';

const SHARED_PROVIDERS = [
  PieceLoaderService,
  {
    provide: PIECES,
    useFactory: async (
      db: DrizzleDb,
      loader: PieceLoaderService,
    ): Promise<Piece[]> => loader.loadEnabledPieces(db),
    inject: [DATABASE_CONNECTION, PieceLoaderService],
  },
  PieceRegistryService,
];

/**
 * Encapsulates piece registration. Any module that needs the registry imports this.
 *
 * Preferred usage — host passes its own import.meta.url so the loader
 * can resolve pieces through the host's node_modules, bypassing pnpm's
 * strict package containment:
 *
 *   PiecesModule.forRoot({ anchorUrl: import.meta.url })
 *
 * Plain import() also works in dev (falls back gracefully).
 */
@Module({})
export class PiecesModule {
  /** Register with an explicit resolution anchor (recommended for production). */
  static forRoot(options: { anchorUrl: string }): DynamicModule {
    return {
      global: true,
      module: PiecesModule,
      providers: [
        { provide: PIECE_LOADER_ANCHOR_URL, useValue: options.anchorUrl },
        ...SHARED_PROVIDERS,
      ],
      exports: [PieceRegistryService, PieceLoaderService, PIECES],
    };
  }

}

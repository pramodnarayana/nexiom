import { DynamicModule, Module } from '@nestjs/common';
import {
  PieceRegistryService,
  PIECES,
} from './piece-registry.service.js';
import { PieceLoaderService } from './piece-loader.service.js';
import { PIECE_RESOLVER } from './piece-resolver.port.js';
import { ProductionPieceResolver } from './production-piece-resolver.js';
import { PluginManagerService } from './plugin-manager.service.js';
import { ExecutionWorkerService } from './execution-worker.service.js';
import { MigrationWorkerService } from './migration-worker.service.js';
import { DATABASE_CONNECTION } from '@soopa/database';
import type { DrizzleDb } from '@soopa/database';
import type { Piece } from '@soopa/piece-framework';

const PIECES_FACTORY_PROVIDER = {
  provide: PIECES,
  useFactory: async (db: DrizzleDb, loader: PieceLoaderService): Promise<Piece[]> =>
    loader.loadEnabledPieces(db),
  inject: [DATABASE_CONNECTION, PieceLoaderService],
};

const CORE_PROVIDERS = [
  ProductionPieceResolver,
  { provide: PIECE_RESOLVER, useExisting: ProductionPieceResolver },
  PieceLoaderService,
  PIECES_FACTORY_PROVIDER,
  PieceRegistryService,
  PluginManagerService,
  ExecutionWorkerService,
];

const CORE_EXPORTS = [
  PieceRegistryService,
  PieceLoaderService,
  PluginManagerService,
  ExecutionWorkerService,
  PIECES,
];

/**
 * Encapsulates piece registration. Any module that needs the registry imports this.
 *
 * ```ts
 * // Standard (production):
 * PiecesModule.forRoot()
 *
 * // Add plugin-migration consumer when explicitly enabled:
 * ...(process.env.ENABLE_PLUGIN_MIGRATIONS === 'true' ? [PiecesModule.withMigrations()] : [])
 * ```
 */
@Module({})
export class PiecesModule {
  /**
   * Standard registration.
   *
   * Resolves pieces via {@link ProductionPieceResolver} — downloads from the NPM registry
   * and loads from the plugin manager disk cache. If a piece fails to resolve, the error
   * is logged and that piece is skipped; the app starts with the successfully loaded set.
   *
   * Does NOT register {@link MigrationWorkerService}. Use {@link withMigrations} when needed.
   */
  static forRoot(): DynamicModule {
    return {
      global: true,
      module: PiecesModule,
      providers: CORE_PROVIDERS,
      exports: CORE_EXPORTS,
    };
  }

  /**
   * Supplementary module that registers the SQS plugin-migration consumer.
   *
   * Import this alongside {@link forRoot} only in processes where
   * ENABLE_PLUGIN_MIGRATIONS=true. The env check lives at the module-composition
   * layer (app.module.ts), not inside the service:
   *
   * ```ts
   * imports: [
   *   PiecesModule.forRoot(),
   *   ...(process.env.ENABLE_PLUGIN_MIGRATIONS === 'true'
   *     ? [PiecesModule.withMigrations()]
   *     : []),
   * ]
   * ```
   */
  static withMigrations(): DynamicModule {
    return {
      module: PiecesModule,
      providers: [MigrationWorkerService],
      exports: [MigrationWorkerService],
    };
  }
}

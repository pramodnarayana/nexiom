import { DynamicModule, Module } from '@nestjs/common';
import { MigratorModule } from '@soopa/migrator';
import {
  PieceRegistryService,
  PIECES,
} from './piece-registry.service.js';
import { PieceLoaderService } from './piece-loader.service.js';
import { PIECE_RESOLVER } from './piece-resolver.port.js';
import { LocalFilePieceResolver } from './local-file.piece-resolver.js';
import { NpmRegistryPieceResolver } from './npm-registry.piece-resolver.js';
import { LocalDevPluginSyncService } from './local-dev-plugin-sync.service.js';
import { PluginManagerService } from './plugin-manager.service.js';
import { PluginSandbox } from './sandbox.js';
import { ExecutionWorkerService } from './execution-worker.service.js';
import { MigrationWorkerService } from './migration-worker.service.js';
import { PIECE_REPOSITORY } from './piece-repository.port.js';
import { DrizzlePieceRepository } from './drizzle-piece.repository.js';
import { DATABASE_CONNECTION } from '@soopa/database';
import type { DrizzleDb } from '@soopa/database';
import type { Piece } from '@soopa/piece-framework';
import { PluginHotReloaderService } from './plugin-hot-reloader.service.js';
import { CacheModule } from '@soopa/cache';

const PIECES_FACTORY_PROVIDER = {
  provide: PIECES,
  useFactory: async (
    db: DrizzleDb,
    loader: PieceLoaderService,
    pluginManager: PluginManagerService,
    localSync: LocalDevPluginSyncService,
  ): Promise<Piece[]> => {
    const isDev = process.env.NODE_ENV === 'development' || process.env.DEV_MODE === 'true';
    if (isDev) {
      await localSync.initialize();
    } else {
      await pluginManager.initializePlugins();
    }
    
    // 2. Load pieces from DB
    return loader.loadEnabledPieces(db);
  },
  inject: [DATABASE_CONNECTION, PieceLoaderService, PluginManagerService, LocalDevPluginSyncService],
};

const CORE_PROVIDERS = [
  LocalFilePieceResolver,
  NpmRegistryPieceResolver,
  LocalDevPluginSyncService,
  {
    provide: PIECE_RESOLVER,
    useFactory: (devResolver: LocalFilePieceResolver, prodResolver: NpmRegistryPieceResolver) => {
      const isDev = process.env.NODE_ENV === 'development' || process.env.DEV_MODE === 'true';
      const disableSync = process.env.DISABLE_LOCAL_SYNC === 'true';
      return (isDev && !disableSync) ? devResolver : prodResolver;
    },
    inject: [LocalFilePieceResolver, NpmRegistryPieceResolver],
  },
  { provide: PIECE_REPOSITORY, useClass: DrizzlePieceRepository },
  PieceLoaderService,
  PIECES_FACTORY_PROVIDER,
  PieceRegistryService,
  PluginManagerService,
  ExecutionWorkerService,
  PluginHotReloaderService,
];

const CORE_EXPORTS = [
  PieceRegistryService,
  PieceLoaderService,
  PluginManagerService,
  LocalDevPluginSyncService,
  ExecutionWorkerService,
  PluginHotReloaderService,
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
      imports: [CacheModule],
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
      imports: [MigratorModule],
      providers: [MigrationWorkerService],
      exports: [MigrationWorkerService],
    };
  }
}

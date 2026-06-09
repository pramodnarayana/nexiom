import { Injectable } from '@nestjs/common';
import type { IPieceResolver } from './piece-resolver.port.js';
import { PluginManagerService } from './plugin-manager.service.js';

/**
 * Production adapter for {@link IPieceResolver}.
 *
 * Downloads the piece from the configured NPM registry via {@link PluginManagerService}
 * (idempotent — skips download if already on disk) then loads it via the plugin manager's
 * module cache. Any failure propagates immediately so {@link PieceLoaderService}
 * can log it and skip the broken piece without crashing the entire boot sequence.
 *
 * Registered by {@link PiecesModule.forRoot} and {@link PiecesModule.forDev}.
 * Never instantiated directly.
 */
@Injectable()
export class ProductionPieceResolver implements IPieceResolver {
  constructor(private readonly pluginManager: PluginManagerService) {}

  async resolve(packageName: string): Promise<Record<string, unknown>> {
    await this.pluginManager.ensurePiece(packageName, 'latest');
    return await this.pluginManager.requirePiece(packageName);
  }
}

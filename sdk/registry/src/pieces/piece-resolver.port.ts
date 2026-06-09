/**
 * Port: resolves a piece package name to its CommonJS module exports.
 *
 * Two adapters bridge this port:
 *  - {@link ProductionPieceResolver} — downloads from the NPM registry via PluginManagerService.
 *  - {@link DevPieceResolver}         — falls back to local workspace resolution when download fails.
 *
 * Registered via the {@link PIECE_RESOLVER} injection token so PieceLoaderService
 * depends only on the abstraction, never on a concrete implementation.
 */
export const PIECE_RESOLVER = 'PIECE_RESOLVER';

export interface IPieceResolver {
  /**
   * Resolves `packageName` to its CommonJS module exports.
   * @throws if the package cannot be located or loaded.
   */
  resolve(packageName: string): Promise<Record<string, unknown>>;
}

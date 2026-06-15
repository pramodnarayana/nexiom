import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NpmRegistryPieceResolver } from './npm-registry.piece-resolver.js';
import type { PluginManagerService } from './plugin-manager.service.js';

describe('NpmRegistryPieceResolver', () => {
  let resolver: NpmRegistryPieceResolver;
  let mockPluginManager: any;

  beforeEach(() => {
    mockPluginManager = {
      ensurePiece: vi.fn().mockResolvedValue({ moduleExports: { module: 'test' } }),
    } as unknown as PluginManagerService;

    resolver = new NpmRegistryPieceResolver(mockPluginManager);
  });

  it('should resolve a piece using PluginManagerService', async () => {
    const result = await resolver.resolve('@soopa/piece-slack');

    expect(mockPluginManager.ensurePiece).toHaveBeenCalledWith('@soopa/piece-slack', 'latest');
    expect(result).toEqual({ module: 'test' });
  });

  it('should propagate errors from ensurePiece', async () => {
    mockPluginManager.ensurePiece = vi.fn().mockRejectedValue(new Error('Install failed'));

    await expect(resolver.resolve('@soopa/piece-slack')).rejects.toThrow('Install failed');
  });
});

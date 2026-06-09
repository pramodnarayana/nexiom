import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProductionPieceResolver } from './production-piece-resolver.js';
import type { PluginManagerService } from './plugin-manager.service.js';

describe('ProductionPieceResolver', () => {
  let resolver: ProductionPieceResolver;
  let mockPluginManager: any;

  beforeEach(() => {
    mockPluginManager = {
      ensurePiece: vi.fn().mockResolvedValue(undefined),
      requirePiece: vi.fn().mockReturnValue({ module: 'test' }),
    };
    resolver = new ProductionPieceResolver(mockPluginManager as unknown as PluginManagerService);
  });

  it('should resolve a piece using PluginManagerService', async () => {
    const result = await resolver.resolve('@soopa/piece-slack');
    
    expect(mockPluginManager.ensurePiece).toHaveBeenCalledWith('@soopa/piece-slack', 'latest');
    expect(mockPluginManager.requirePiece).toHaveBeenCalledWith('@soopa/piece-slack');
    expect(result).toEqual({ module: 'test' });
  });

  it('should propagate errors from ensurePiece', async () => {
    mockPluginManager.ensurePiece = vi.fn().mockRejectedValue(new Error('Network error'));
    
    await expect(resolver.resolve('@soopa/piece-slack')).rejects.toThrow('Network error');
    expect(mockPluginManager.requirePiece).not.toHaveBeenCalled();
  });
});

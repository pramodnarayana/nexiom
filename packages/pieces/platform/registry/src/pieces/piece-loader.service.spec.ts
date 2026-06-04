import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { PieceLoaderService } from './piece-loader.service.js';
import { PluginManagerService } from './plugin-manager.service.js';
import type { DrizzleDb } from '@soopa/database';

describe('PieceLoaderService', () => {
  let service: PieceLoaderService;
  let pluginManagerService: Mocked<PluginManagerService>;
  let mockDb: Mocked<DrizzleDb>;

  beforeEach(() => {
    pluginManagerService = {
      ensurePiece: vi.fn(),
      requirePiece: vi.fn(),
    } as unknown as Mocked<PluginManagerService>;

    const mockSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { name: 'slack', packageName: '@soopa/piece-slack', enabled: true }
      ])
    };

    mockDb = {
      select: vi.fn().mockReturnValue(mockSelect)
    } as unknown as Mocked<DrizzleDb>;

    service = new PieceLoaderService(null, pluginManagerService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully load pieces via pluginManager during Startup Sync', async () => {
    pluginManagerService.ensurePiece.mockResolvedValueOnce(undefined);
    pluginManagerService.requirePiece.mockReturnValueOnce({
      slackPiece: {
        name: 'slack',
        displayName: 'Slack',
        description: 'desc',
        logoUrl: 'url',
        actions: {},
        triggers: {},
        auth: {},
        categories: []
      }
    });

    const result = await service.loadEnabledPieces(mockDb);

    expect(pluginManagerService.ensurePiece).toHaveBeenCalledWith('@soopa/piece-slack', 'latest');
    expect(pluginManagerService.requirePiece).toHaveBeenCalledWith('@soopa/piece-slack');
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('slack');
  });

  it('should fallback to local workspace resolution if ensurePiece throws', async () => {
    pluginManagerService.ensurePiece.mockRejectedValueOnce(new Error('404 Not Found'));
    
    // We expect the catch block to run, which tries local import.
    // Since @soopa/piece-slack isn't actually in our local node_modules for the test environment,
    // it will throw a module resolution error and fail to extract. 
    // We just want to ensure it caught the error and didn't crash the loader.
    const result = await service.loadEnabledPieces(mockDb);
    
    expect(pluginManagerService.ensurePiece).toHaveBeenCalledWith('@soopa/piece-slack', 'latest');
    // It should have caught the 404 and returned 0 pieces instead of blowing up the boot process
    expect(result.length).toBe(0);
  });
});

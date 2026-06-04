import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { PluginManagerService } from './plugin-manager.service.js';
import { QueueName } from '@soopa/queue';
import type { IQueueService } from '@soopa/queue';

// Mock live-plugin-manager so we don't actually hit the network or filesystem
vi.mock('live-plugin-manager', () => {
  return {
    PluginManager: vi.fn().mockImplementation(() => {
      return {
        getInfo: vi.fn(),
        install: vi.fn(),
        require: vi.fn(),
      };
    })
  };
});

describe('PluginManagerService', () => {
  let service: PluginManagerService;
  let queueService: Mocked<IQueueService>;
  
  beforeEach(() => {
    queueService = {
      send: vi.fn(),
      consume: vi.fn(),
    } as unknown as Mocked<IQueueService>;

    service = new PluginManagerService(queueService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('ensurePiece', () => {
    it('should skip download if the piece is already installed locally', async () => {
      const mockGetInfo = vi.spyOn((service as any).manager, 'getInfo').mockReturnValue({ version: '1.0.0', location: '/tmp' });
      const mockInstall = vi.spyOn((service as any).manager, 'install');

      const result = await service.ensurePiece('@soopa/piece-test', 'latest');
      
      expect(result).toEqual({ version: '1.0.0', location: '/tmp' });
      expect(mockGetInfo).toHaveBeenCalledWith('@soopa/piece-test');
      expect(mockInstall).not.toHaveBeenCalled();
    });

    it('should install piece if it is not installed locally', async () => {
      const mockGetInfo = vi.spyOn((service as any).manager, 'getInfo').mockReturnValue(undefined);
      const mockInstall = vi.spyOn((service as any).manager, 'install').mockResolvedValue({ version: '1.2.0', location: '/tmp/new' });

      const result = await service.ensurePiece('@soopa/piece-new', '1.2.0');
      
      expect(result).toEqual({ version: '1.2.0', location: '/tmp/new' });
      expect(mockGetInfo).toHaveBeenCalledWith('@soopa/piece-new');
      expect(mockInstall).toHaveBeenCalledWith('@soopa/piece-new', '1.2.0');
    });
  });

  describe('installPiece', () => {
    it('should install piece and immediately dispatch a migration event to SQS', async () => {
      const mockInstall = vi.spyOn((service as any).manager, 'install').mockResolvedValue({ version: '2.0.0', location: '/tmp/plugin' });

      const result = await service.installPiece('@soopa/piece-migrate', '2.0.0');
      
      expect(result).toEqual({ version: '2.0.0', location: '/tmp/plugin' });
      expect(mockInstall).toHaveBeenCalledWith('@soopa/piece-migrate', '2.0.0');
      expect(queueService.send).toHaveBeenCalledWith(QueueName.TenantProvisionQueue, {
        pluginLocation: '/tmp/plugin',
        pieceName: '@soopa/piece-migrate'
      });
    });

    it('should throw an error and NOT dispatch event if installation fails', async () => {
      const mockInstall = vi.spyOn((service as any).manager, 'install').mockRejectedValue(new Error('NPM is down'));

      await expect(service.installPiece('@soopa/piece-migrate', 'latest')).rejects.toThrow('NPM is down');
      expect(queueService.send).not.toHaveBeenCalled();
    });
  });

  describe('requirePiece', () => {
    it('should call manager.require', () => {
      const mockRequire = vi.spyOn((service as any).manager, 'require').mockReturnValue({ default: {} });
      const result = service.requirePiece('@soopa/piece-local');
      expect(result).toEqual({ default: {} });
      expect(mockRequire).toHaveBeenCalledWith('@soopa/piece-local');
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { PluginManagerService } from './plugin-manager.service.js';
import { QueueName } from '@soopa/queue';
import type { IQueueService } from '@soopa/queue';
import * as fs from 'fs';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
  };
});

// Mock live-plugin-manager so we don't actually hit the network or filesystem
vi.mock('live-plugin-manager', () => {
  return {
    PluginManager: vi.fn().mockImplementation(() => {
      return {
        getInfo: vi.fn(),
        install: vi.fn(),
        uninstall: vi.fn(),
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

  describe('constructor', () => {
    it('should create plugins directory with 0o700 permissions if it does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(false);
      
      new PluginManagerService(queueService);
      
      expect(fs.existsSync).toHaveBeenCalled();
      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true, mode: 0o700 });
    });

    it('should chmod existing directory to 0o700 if it already exists', () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(true);
      
      new PluginManagerService(queueService);
      
      expect(fs.existsSync).toHaveBeenCalled();
      expect(fs.chmodSync).toHaveBeenCalledWith(expect.any(String), 0o700);
    });
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
      const mockInstallPiece = vi.spyOn(service, 'installPiece').mockResolvedValue({ version: '1.2.0', location: '/tmp/new' });

      const result = await service.ensurePiece('@soopa/piece-new', '1.2.0');
      
      expect(result).toEqual({ version: '1.2.0', location: '/tmp/new' });
      expect(mockGetInfo).toHaveBeenCalledWith('@soopa/piece-new');
      expect(mockInstallPiece).toHaveBeenCalledWith('@soopa/piece-new', '1.2.0');
    });
  });

  describe('installPiece', () => {
    it('should install piece and immediately dispatch a migration event to SQS', async () => {
      process.env.ENABLE_PLUGIN_MIGRATIONS = 'true';
      const mockInstall = vi.spyOn((service as any).manager, 'install').mockResolvedValue({ version: '2.0.0', location: '/tmp/plugin' });

      const result = await service.installPiece('@soopa/piece-migrate', '2.0.0');
      
      expect(result).toEqual({ version: '2.0.0', location: '/tmp/plugin' });
      expect(mockInstall).toHaveBeenCalledWith('@soopa/piece-migrate', '2.0.0');
      expect(queueService.send).toHaveBeenCalledWith(QueueName.TenantProvisionQueue, {
        pluginLocation: '/tmp/plugin',
        pieceName: '@soopa/piece-migrate'
      });
      delete process.env.ENABLE_PLUGIN_MIGRATIONS;
    });

    it('should skip migration dispatch if ENABLE_PLUGIN_MIGRATIONS is not true', async () => {
      delete process.env.ENABLE_PLUGIN_MIGRATIONS;
      const mockInstall = vi.spyOn((service as any).manager, 'install').mockResolvedValue({ version: '2.0.0', location: '/tmp/plugin' });

      const result = await service.installPiece('@soopa/piece-migrate', '2.0.0');
      
      expect(result).toEqual({ version: '2.0.0', location: '/tmp/plugin' });
      expect(mockInstall).toHaveBeenCalledWith('@soopa/piece-migrate', '2.0.0');
      expect(queueService.send).not.toHaveBeenCalled();
    });

    it('should throw an error and NOT dispatch event if installation fails', async () => {
      const mockInstall = vi.spyOn((service as any).manager, 'install').mockRejectedValue(new Error('NPM is down'));

      await expect(service.installPiece('@soopa/piece-migrate', 'latest')).rejects.toThrow('NPM is down');
      expect(queueService.send).not.toHaveBeenCalled();
    });

    it('should rollback installation if SQS dispatch fails', async () => {
      process.env.ENABLE_PLUGIN_MIGRATIONS = 'true';
      const mockInstall = vi.spyOn((service as any).manager, 'install').mockResolvedValue({ version: '2.0.0', location: '/tmp/plugin' });
      const mockUninstall = vi.spyOn((service as any).manager, 'uninstall').mockResolvedValue(undefined);
      
      queueService.send.mockRejectedValue(new Error('SQS is down'));

      await expect(service.installPiece('@soopa/piece-migrate', '2.0.0')).rejects.toThrow('SQS is down');
      
      expect(mockInstall).toHaveBeenCalledWith('@soopa/piece-migrate', '2.0.0');
      expect(mockUninstall).toHaveBeenCalledWith('@soopa/piece-migrate');
      
      delete process.env.ENABLE_PLUGIN_MIGRATIONS;
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

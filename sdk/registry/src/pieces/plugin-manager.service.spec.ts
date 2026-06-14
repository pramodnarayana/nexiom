import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PluginManagerService } from './plugin-manager.service.js';
import type { IQueueService } from '@soopa/queue';
import * as fs from 'fs';
import type { IPluginInfo } from 'live-plugin-manager';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    promises: {
      access: vi.fn(),
      mkdir: vi.fn(),
      chmod: vi.fn(),
      readdir: vi.fn(),
    }
  };
});

// Mock live-plugin-manager so we don't actually hit the network or filesystem
vi.mock('live-plugin-manager', () => {
  return {
    PluginManager: vi.fn().mockImplementation(function() {
      return {
        getInfo: vi.fn(),
        install: vi.fn(),
        uninstall: vi.fn(),
        require: vi.fn(),
        installFromPath: vi.fn(),
      };
    })
  };
});

// Mock node:child_process
vi.mock('node:child_process', () => {
  return {
    execSync: vi.fn(),
  };
});

describe('PluginManagerService', () => {
  let service: PluginManagerService;
  let queueService: Mocked<IQueueService>;
  let mockConfigService: Mocked<ConfigService>;
  
  beforeEach(() => {
    queueService = {
      send: vi.fn(),
      consume: vi.fn(),
    } as unknown as Mocked<IQueueService>;

    mockConfigService = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'PLUGINS_DIRECTORY') return './plugins';
        return undefined;
      })
    } as unknown as Mocked<ConfigService>;

    service = new PluginManagerService(queueService, mockConfigService);
  });

  describe('initializePlugins', () => {
    it('should create plugins directory with 0o700 permissions if it does not exist', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      vi.mocked(fs.promises.access).mockRejectedValueOnce(error);
      
      await service.initializePlugins();
      
      expect(fs.promises.access).toHaveBeenCalled();
      expect(fs.promises.mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true, mode: 0o700 });
    });

    it('should chmod existing directory to 0o700 if it already exists', async () => {
      vi.mocked(fs.promises.access).mockResolvedValueOnce(undefined);
      
      await service.initializePlugins();
      
      expect(fs.promises.access).toHaveBeenCalled();
      expect(fs.promises.chmod).toHaveBeenCalledWith(expect.any(String), 0o700);
    });

  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('ensurePiece', () => {
    it('should skip download if the piece is already installed locally', async () => {
      const mockPluginInfo = { version: '1.0.0', location: '/tmp', name: '@soopa/piece-test', mainFile: '', dependencies: {} } as IPluginInfo;
      const mockGetInfo = vi.spyOn((service as any).manager, 'getInfo').mockReturnValue(mockPluginInfo);
      const mockInstall = vi.spyOn((service as any).manager, 'install');

      const result = await service.ensurePiece('@soopa/piece-test', 'latest');
      
      expect(result).toEqual(mockPluginInfo);
      expect(mockGetInfo).toHaveBeenCalledWith('@soopa/piece-test');
      expect(mockInstall).not.toHaveBeenCalled();
    });

    it('should install piece if it is not installed locally', async () => {
      const mockPluginInfo = { version: '1.2.0', location: '/tmp/new', name: '@soopa/piece-new', mainFile: '', dependencies: {} } as IPluginInfo;
      const mockGetInfo = vi.spyOn((service as any).manager, 'getInfo').mockReturnValue(undefined);
      const mockInstallPiece = vi.spyOn(service, 'installPiece').mockResolvedValue(mockPluginInfo);

      const result = await service.ensurePiece('@soopa/piece-new', '1.2.0');
      
      expect(result).toEqual(mockPluginInfo);
      expect(mockGetInfo).toHaveBeenCalledWith('@soopa/piece-new');
      expect(mockInstallPiece).toHaveBeenCalledWith('@soopa/piece-new', '1.2.0');
    });
  });

  describe('installPiece', () => {
    it('should install piece using manager', async () => {
      const mockPluginInfo = { version: '2.0.0', location: '/tmp/plugin', name: '@soopa/piece-install', mainFile: '', dependencies: {} } as IPluginInfo;
      const mockInstall = vi.spyOn((service as any).manager, 'install').mockResolvedValue(mockPluginInfo);

      const result = await service.installPiece('@soopa/piece-install', '2.0.0');
      
      expect(result).toEqual(mockPluginInfo);
      expect(mockInstall).toHaveBeenCalledWith('@soopa/piece-install', '2.0.0');
    });

    it('should throw an error if installation fails', async () => {
      const mockInstall = vi.spyOn((service as any).manager, 'install').mockRejectedValue(new Error('NPM is down'));

      await expect(service.installPiece('@soopa/piece-fail', 'latest')).rejects.toThrow('NPM is down');
    });
  });

  describe('requirePiece', () => {
    it('should call manager.require if async import fails', async () => {
      // Mock getPieceInfo to return mock info
      vi.spyOn(service, 'getPieceInfo').mockReturnValue({
        version: '1.0.0', location: '/tmp', name: '@soopa/piece-local', mainFile: '', dependencies: {}
      } as IPluginInfo);
      
      const mockRequire = vi.spyOn((service as any).manager, 'require').mockReturnValue({ default: {} });
      const result = await service.requirePiece('@soopa/piece-local');
      expect(result).toEqual({ default: {} });
      expect(mockRequire).toHaveBeenCalledWith('@soopa/piece-local');
    });
  });
});

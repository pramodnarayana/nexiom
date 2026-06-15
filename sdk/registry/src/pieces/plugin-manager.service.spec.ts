import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import {
  PluginManagerService,
  encodePackageName,
  resolvePackageEntry,
} from './plugin-manager.service.js';

// Mock child_process and sandbox
vi.mock('child_process', () => ({
  exec: vi.fn<any>((cmd: any, optionsOrCallback: any, cb: any) => {
    if (typeof optionsOrCallback === 'function') {
      optionsOrCallback(null, { stdout: 'success', stderr: '' });
    } else if (typeof cb === 'function') {
      cb(null, { stdout: 'success', stderr: '' });
    }
  }),
}));
vi.mock('./sandbox.js', () => ({
  PluginSandbox: {
    evaluateModule: vi.fn().mockReturnValue({ piece: { name: 'mocked' } }),
  },
}));
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue('{}'),
    },
    readFileSync: vi.fn().mockReturnValue('{}'),
    existsSync: vi.fn().mockReturnValue(true),
  };
});

describe('plugin-manager.service', () => {
  describe('encodePackageName', () => {
    it('should correctly encode scoped packages', () => {
      expect(encodePackageName('@soopa/piece-salesforce')).toBe('_at_soopa__piece-salesforce');
    });

    it('should correctly encode normal packages', () => {
      expect(encodePackageName('lodash')).toBe('lodash');
    });
  });

  describe('resolvePackageEntry', () => {
    it('should resolve the default main entry if no exports exist', () => {
      expect(resolvePackageEntry({ main: 'dist/index.js' })).toBe('dist/index.js');
    });

    it('should fallback to index.js if neither main nor exports exist', () => {
      expect(resolvePackageEntry({})).toBe('index.js');
    });

    it('should resolve string exports dot', () => {
      expect(resolvePackageEntry({ exports: { '.': 'src/index.js' } })).toBe('src/index.js');
    });

    it('should resolve object exports dot with require', () => {
      expect(
        resolvePackageEntry({
          exports: {
            '.': {
              require: 'dist/index.cjs',
              default: 'dist/index.js',
            },
          },
        }),
      ).toBe('dist/index.cjs');
    });

    it('should resolve object exports dot with default fallback', () => {
      expect(
        resolvePackageEntry({
          exports: {
            '.': {
              default: 'dist/index.mjs',
            },
          },
        }),
      ).toBe('dist/index.mjs');
    });
  });

  describe('PluginManagerService', () => {
    let service: PluginManagerService;
    let mockConfigService: any;

    beforeEach(() => {
      mockConfigService = {
        get: vi.fn((key: string) => {
          if (key === 'NODE_ENV') return 'test';
          if (key === 'APP_DATA_DIR') return '/tmp/soopa-test';
          if (key === 'PLUGINS_PATH') return '/tmp/soopa-test/plugins';
          if (key === 'NPM_REGISTRY_URL') return 'http://localhost:4873/';
          return undefined;
        }),
      };

      service = new PluginManagerService(mockConfigService as unknown as ConfigService);
    });

    it('should initialize successfully with config overrides', () => {
      expect(service).toBeDefined();
      expect(mockConfigService.get).toHaveBeenCalledWith('PLUGINS_PATH');
    });

    it('should safely return onModuleInit void promise', async () => {
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });

    it('should execute initializePlugins and create plugins path', async () => {
      await service.initializePlugins();
      expect(fs.promises.mkdir).toHaveBeenCalledWith('/tmp/soopa-test/plugins', expect.anything());
    });

    it('should return cached initPromise if called twice', async () => {
      const mkdirSpy = vi.spyOn(fs.promises, 'mkdir');
      mkdirSpy.mockReset();
      mkdirSpy.mockResolvedValue(undefined);
      const newService = new PluginManagerService(mockConfigService);
      const p1 = newService.initializePlugins();
      const p2 = newService.initializePlugins();
      await Promise.all([p1, p2]);
      expect(mkdirSpy).toHaveBeenCalledTimes(1);
    });

    it('should clear initPromise and throw if mkdir fails', async () => {
      const newService = new PluginManagerService(mockConfigService);
      const mkdirSpy = vi.spyOn(fs.promises, 'mkdir');
      mkdirSpy.mockReset();
      mkdirSpy.mockRejectedValueOnce(new Error('MKDIR FAILED'));
      
      await expect(newService.initializePlugins()).rejects.toThrow('MKDIR FAILED');
      
      // Reset mock back to successful state for subsequent tests!
      mkdirSpy.mockReset();
      mkdirSpy.mockResolvedValue(undefined);
    });

    it('should execute installPiece and return PluginInfo', async () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
        name: 'test-piece',
        version: '1.0.0',
        main: 'dist/index.js'
      }));

      const result = await service.installPiece('@soopa/test-piece', '1.0.0');
      
      expect(result).toBeDefined();
      expect(result.version).toBe('1.0.0');
      expect(result.moduleExports.piece).toBeDefined();
    });

    it('should execute ensurePiece from memory cache', async () => {
      const child_process = await import('child_process');
      const execSpy = vi.spyOn(child_process, 'exec');
      execSpy.mockClear();

      // First install it to populate the memory cache
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
        name: 'test-piece',
        version: '1.0.0',
        main: 'dist/index.js'
      }));
      await service.installPiece('@soopa/test-piece', '1.0.0');
      
      const result = await service.ensurePiece('@soopa/test-piece', '1.0.0');
      expect(result.moduleExports.piece).toBeDefined();
    });

    it('should skip download if directory already exists', async () => {
      vi.spyOn(fs.promises, 'access').mockResolvedValueOnce(undefined);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
        name: 'test-piece',
        version: '1.0.0',
        main: 'dist/index.js'
      }));

      const child_process = await import('child_process');
      const execSpy = vi.spyOn(child_process, 'exec');
      execSpy.mockClear();
      
      const result = await service.installPiece('@soopa/existing-piece', '1.0.0');
      
      expect(execSpy).not.toHaveBeenCalled();
      expect(result.version).toBe('1.0.0');
    });

    it('should throw error if npm install fails', async () => {
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValueOnce(undefined);
      const child_process = await import('child_process');
      vi.spyOn(child_process, 'exec').mockImplementationOnce((cmd, opts, cb) => {
        if (typeof cb === 'function') {
          (cb as any)(new Error('NPM FAILED'), { stdout: '', stderr: 'npm ERR!' });
        }
        return {} as any;
      });

      await expect(service.installPiece('@soopa/fail-piece', '1.0.0')).rejects.toThrow('NPM FAILED');
    });

    it('should resolve latest version using npm view', async () => {
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ name: 'test', main: 'index.js' }));
      const child_process = await import('child_process');
      vi.spyOn(child_process, 'exec').mockImplementation((cmd, opts, cb) => {
        const callback = typeof opts === 'function' ? opts : cb;
        if (typeof callback === 'function') {
          if (cmd.includes('npm view')) {
            (callback as any)(null, { stdout: '2.0.0', stderr: '' });
          } else {
            (callback as any)(null, { stdout: 'success', stderr: '' });
          }
        }
        return {} as any;
      });

      const result = await service.installPiece('@soopa/latest-piece', 'latest');
      expect(result.version).toBe('2.0.0');
    });

    it('should throw if npm view fails', async () => {
      const child_process = await import('child_process');
      vi.spyOn(child_process, 'exec').mockImplementationOnce((cmd, opts, cb) => {
        const callback = typeof opts === 'function' ? opts : cb;
        if (typeof callback === 'function') {
          (callback as any)(new Error('NPM VIEW FAILED'), { stdout: '', stderr: '' });
        }
        return {} as any;
      });

      await expect(service.installPiece('@soopa/latest-piece', 'latest')).rejects.toThrow('Failed to resolve version');
    });

    it('should throw if sandbox evaluation fails', async () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ name: 'test', main: 'index.js' }));
      const sandbox = await import('./sandbox.js');
      vi.spyOn(sandbox.PluginSandbox, 'evaluateModule').mockImplementationOnce(() => {
        throw new Error('Sandbox exploded');
      });

      await expect(service.installPiece('@soopa/sandbox-fail', '1.0.0')).rejects.toThrow(/Failed to require.*Sandbox exploded/);
    });

    it('should throw if module exports non-object', async () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ name: 'test', main: 'index.js' }));
      const sandbox = await import('./sandbox.js');
      vi.spyOn(sandbox.PluginSandbox, 'evaluateModule').mockReturnValueOnce(null as any);

      await expect(service.installPiece('@soopa/bad-export', '1.0.0')).rejects.toThrow(/Piece exported a non-object value/);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginSandbox } from './sandbox.js';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('fs');
vi.mock('module', async () => {
  const actual = await vi.importActual<typeof import('module')>('module');
  return {
    ...actual,
    createRequire: () => {
      const req: any = (id: string) => {
        if (id === 'fs') return { readFileSync: () => 'mocked-fs' };
        return {};
      };
      req.resolve = (id: string) => {
        if (id === 'throw-me') throw new Error('Mock resolve error');
        if (id === 'throw-string') throw 'String error';
        if (id.startsWith('./')) return '/test/' + id.replace('./', '');
        return id;
      };
      return req;
    }
  };
});

describe('sandbox', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('PluginSandbox', () => {
    it('should return cached exports if available', () => {
      const mockCache = {
        '/test/index.js': { exports: { foo: 'bar' } },
      };
      
      const result = PluginSandbox.evaluateModule('/test/index.js', {}, mockCache);
      expect(result).toEqual({ foo: 'bar' });
    });

    it('should evaluate a simple module', () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue('module.exports = { value: 42 };');
      
      const result = PluginSandbox.evaluateModule('/test/simple.js', {});
      expect(result.value).toBe(42);
      expect(fs.readFileSync).toHaveBeenCalledWith('/test/simple.js', 'utf-8');
    });

    it('should correctly inject static dependencies', () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue('const dep = require("static-dep"); module.exports = { dep };');
      
      const staticDeps = { 'static-dep': { secret: 123 } };
      const result = PluginSandbox.evaluateModule('/test/deps.js', staticDeps);
      
      expect(result.dep).toEqual({ secret: 123 });
    });

    it('should recursively evaluate local relative requires', () => {
      vi.spyOn(fs, 'readFileSync').mockImplementation((filePath) => {
        if (filePath.toString().endsWith('index.js')) {
          return 'const util = require("./util.js"); module.exports = { util };';
        }
        if (filePath.toString().endsWith('util.js')) {
          return 'module.exports = { fn: () => true };';
        }
        return '';
      });

      // Need to mock fs.existsSync and fs.statSync to trick createRequire inside sandbox
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => false } as any);

      // Node's createRequire requires the path to be somewhat valid, but we can just use the sandbox
      const result = PluginSandbox.evaluateModule(path.resolve('/test/index.js'), {});
      expect(result).toBeDefined();
    });

    it('should throw an error if require.resolve fails with Error', () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue('require("throw-me");');
      expect(() => PluginSandbox.evaluateModule('/test/index.js', {})).toThrow(/Sandbox require failed to resolve 'throw-me'.*Mock resolve error/);
    });

    it('should throw an error if require.resolve fails with string', () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue('require("throw-string");');
      expect(() => PluginSandbox.evaluateModule('/test/index.js', {})).toThrow(/String error/);
    });

    it('should return native modules directly', () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue('const fs = require("fs"); module.exports = { fs };');
      const result = PluginSandbox.evaluateModule('/test/index.js', {});
      expect(result.fs).toBeDefined();
      expect((result.fs as any).readFileSync()).toBe('mocked-fs');
    });
  });
});

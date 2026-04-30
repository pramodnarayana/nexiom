import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

// ── Module Mocking ────────────────────────────────────────────────────────────
// We mock esbuild so tests don't need real shard files on disk
vi.mock('esbuild', () => ({
  build: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  mkdir: vi.fn(),
}));

// We DO NOT mock quickjs-emscripten — the entire point is to test real sandbox behavior

import * as esbuild from 'esbuild';
import { ApplicationExecutorService } from './application-executor.service.js';
import { InternalServerErrorException } from '@nestjs/common';

// A minimal, self-contained IIFE bundle that the "esbuild" mock will return
const makeShardBundle = (fnName: string, fnBody: string) =>
  `var CustomLogic = (function() {
    function ${fnName}(payload) { ${fnBody} }
    return { ${fnName}: ${fnName} };
  })();`;

describe('ApplicationExecutorService — WebAssembly Sandbox', () => {
  let service: ApplicationExecutorService;

  beforeEach(() => {
    service = new ApplicationExecutorService();
    vi.clearAllMocks();

    // Default: file access succeeds
    vi.mocked(fs.access).mockResolvedValue(undefined);
  });

  // ── Path Traversal Guard ──────────────────────────────────────────────────
  it('throws on path traversal attempt', async () => {
    await expect(
      service.executeCustomMapping('t1', '../../../etc/passwd', 'transform', {})
    ).rejects.toThrow(InternalServerErrorException);
  });

  // ── Missing Shard File ────────────────────────────────────────────────────
  it('throws when shard module file does not exist', async () => {
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
    await expect(
      service.executeCustomMapping('t1', 'my-shard', 'transform', {})
    ).rejects.toThrow(InternalServerErrorException);
  });

  // ── Successful Execution ──────────────────────────────────────────────────
  it('executes transform and returns result through the WebAssembly boundary', async () => {
    vi.mocked(esbuild.build).mockResolvedValue({
      outputFiles: [
        { text: makeShardBundle('transform', 'return { result: payload.value * 2 };') },
      ],
    } as never);

    const result = await service.executeCustomMapping(
      't1', 'my-shard', 'transform', { value: 21 }
    );

    expect(result).toEqual({ result: 42 });
  });

  // ── Cache Hit ─────────────────────────────────────────────────────────────
  it('only calls esbuild once for repeated invocations of the same shard', async () => {
    vi.mocked(esbuild.build).mockResolvedValue({
      outputFiles: [
        { text: makeShardBundle('transform', 'return { ok: true };') },
      ],
    } as never);

    await service.executeCustomMapping('t1', 'my-shard', 'transform', {});
    await service.executeCustomMapping('t1', 'my-shard', 'transform', {});

    expect(esbuild.build).toHaveBeenCalledTimes(1);
  });

  // ── Cache Invalidation ────────────────────────────────────────────────────
  it('re-bundles after invalidateCache is called', async () => {
    vi.mocked(esbuild.build).mockResolvedValue({
      outputFiles: [
        { text: makeShardBundle('transform', 'return { ok: true };') },
      ],
    } as never);

    await service.executeCustomMapping('t1', 'my-shard', 'transform', {});
    service.invalidateCache('my-shard');
    await service.executeCustomMapping('t1', 'my-shard', 'transform', {});

    // esbuild called twice — once before and once after cache invalidation
    expect(esbuild.build).toHaveBeenCalledTimes(2);
  });

  // ── Unknown Function Guard ────────────────────────────────────────────────
  it('throws when the requested function is not exported by the shard', async () => {
    vi.mocked(esbuild.build).mockResolvedValue({
      outputFiles: [
        { text: makeShardBundle('transform', 'return {};') },
      ],
    } as never);

    await expect(
      service.executeCustomMapping('t1', 'my-shard', 'nonExistentFn', {})
    ).rejects.toThrow(InternalServerErrorException);
  });

  // ── Security Boundary: No Node.js API Access ──────────────────────────────
  it('sandbox prevents access to Node.js process object', async () => {
    vi.mocked(esbuild.build).mockResolvedValue({
      outputFiles: [{
        // Attempt to read process.env — should be undefined inside the sandbox
        text: makeShardBundle('exfiltrate', `
          var leaked = typeof process !== 'undefined' ? JSON.stringify(process.env) : 'BLOCKED';
          return { leaked };
        `),
      }],
    } as never);

    const result = await service.executeCustomMapping(
      't1', 'my-shard', 'exfiltrate', {}
    );

    // process is not defined in the QuickJS sandbox — it should be 'BLOCKED'
    expect(result).toEqual({ leaked: 'BLOCKED' });
  });

  // ── Security Boundary: Memory Limit ──────────────────────────────────────
  it('sandbox enforces memory limit and throws on excessive allocation', async () => {
    vi.mocked(esbuild.build).mockResolvedValue({
      outputFiles: [{
        // Attempt to allocate a 200MB string in one shot — exceeds the 128MB hard limit.
        // Using a single large allocation is safer than a loop: it triggers the QuickJS
        // OOM boundary instantly without exhausting Node.js host memory.
        text: makeShardBundle('memBomb', `
          var bomb = 'a'.repeat(200 * 1024 * 1024);
          return { size: bomb.length };
        `),
      }],
    } as never);

    await expect(
      service.executeCustomMapping('t1', 'my-shard', 'memBomb', {})
    ).rejects.toThrow(InternalServerErrorException);
  });
});

/**
 * ExecutionWorkerService tests — narrow integration tests.
 *
 * We do NOT mock Piscina internals. Instead we expose the pool as a
 * settable property and inject a hand-crafted WorkerPool stub.
 * This tests the timeout/abort orchestration logic — the only logic
 * that lives in this class — without touching real threads or the filesystem.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExecutionWorkerService } from './execution-worker.service.js';

// ─── Stub WorkerPool ─────────────────────────────────────────────────────────
// A minimal implementation of the WorkerPool interface that we can control
// from test code. No mocking framework needed — just a plain object.

function makeStubPool(
  runImpl: (input: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>,
) {
  return {
    run: runImpl,
    destroy: async () => { /* no-op */ },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeService(): ExecutionWorkerService {
  // Bypass NestJS DI and onModuleInit — we inject the pool manually.
  const svc = new ExecutionWorkerService();
  return svc;
}

function injectPool(
  svc: ExecutionWorkerService,
  pool: { run: (input: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>; destroy: () => Promise<void> },
): void {
  // TypeScript: access private field via index signature for testing only.
  (svc as unknown as Record<string, unknown>)['pool'] = pool;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ExecutionWorkerService', () => {
  let service: ExecutionWorkerService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = makeService();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('executeTrigger', () => {
    it('resolves with the value returned by the pool', async () => {
      injectPool(service, makeStubPool(() => Promise.resolve('ok')));

      const result = await service.executeTrigger('/script.js', 'myTrigger', { data: 1 });

      expect(result).toBe('ok');
    });

    it('passes scriptPath, triggerName and payload to the pool', async () => {
      const calls: unknown[] = [];
      injectPool(
        service,
        makeStubPool((input) => {
          calls.push(input);
          return Promise.resolve(null);
        }),
      );

      await service.executeTrigger('/path/script.js', 'onSync', { id: 42 });

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        scriptPath: '/path/script.js',
        triggerName: 'onSync',
        payload: { id: 42 },
      });
    });

    it('aborts the pool task and rejects after 30 s', async () => {
      injectPool(
        service,
        makeStubPool((_input, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () =>
              queueMicrotask(() => reject(new Error('AbortError'))),
            );
          }),
        ),
      );

      const promise = service.executeTrigger('/hang.js', 'slowTrigger', {});
      // Suppress unhandled-rejection noise while we drive timers
      promise.catch(() => {});

      await vi.advanceTimersByTimeAsync(30_000);

      await expect(promise).rejects.toThrow('AbortError');
    });

    it('re-throws pool errors unchanged', async () => {
      injectPool(
        service,
        makeStubPool(() => Promise.reject(new Error('pool exploded'))),
      );

      await expect(
        service.executeTrigger('/script.js', 'trigger', {}),
      ).rejects.toThrow('pool exploded');
    });

    it('re-throws non-Error rejections as strings', async () => {
      injectPool(
        service,
        makeStubPool(() => Promise.reject('String error!')),
      );

      const promise = service.executeTrigger('/err.js', 'errTrigger', {});
      await expect(promise).rejects.toThrow('String error!');
    });
  });

  describe('Lifecycle Hooks', () => {
    it('initializes and destroys the worker pool', async () => {
      // Temporarily bypass testing logic
      vi.mock('module', async () => {
        const actual = await vi.importActual<typeof import('module')>('module');
        return {
          ...actual,
          createRequire: () => () => {
            return class MockPiscina {
              constructor(opts: any) {}
              destroy = vi.fn().mockResolvedValue(undefined);
              run = vi.fn();
            };
          }
        };
      });

      const svc = new ExecutionWorkerService();
      svc.onModuleInit();
      expect((svc as any).pool).toBeDefined();

      await svc.onModuleDestroy();
      expect((svc as any).pool.destroy).toHaveBeenCalled();
    });
  });
});

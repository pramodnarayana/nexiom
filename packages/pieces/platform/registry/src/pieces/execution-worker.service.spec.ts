import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExecutionWorkerService } from './execution-worker.service.js';

// Mock Piscina
vi.mock('piscina', () => {
  return {
    default: vi.fn().mockImplementation(() => {
      return {
        run: vi.fn()
      };
    })
  };
});

describe('ExecutionWorkerService', () => {
  let service: ExecutionWorkerService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new ExecutionWorkerService();
    // Manually trigger onModuleInit to construct the pool
    service.onModuleInit();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('executeTrigger', () => {
    it('should successfully execute a payload via Piscina', async () => {
      const mockRun = vi.spyOn((service as any).pool, 'run').mockResolvedValue('success');

      const result = await service.executeTrigger('/path/script.js', 'myTrigger', { data: 123 });
      
      expect(result).toBe('success');
      expect(mockRun).toHaveBeenCalledWith(
        { scriptPath: '/path/script.js', triggerName: 'myTrigger', payload: { data: 123 } },
        { signal: expect.any(AbortSignal) }
      );
    });

    it('should properly abort and throw an error if the Piscina task takes longer than 30s', async () => {
      // Simulate a Piscina run that hangs indefinitely until aborted
      const mockRun = vi.spyOn((service as any).pool, 'run').mockImplementation((task, options: any) => {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            // Reject on next tick via microtask queue to avoid unhandled rejection bubbling
            // from EventTarget listener, while bypassing fake timers deadlock.
            queueMicrotask(() => reject(new Error('AbortError')));
          });
        });
      });

      // Start the execution without awaiting it yet.
      // Attach a dummy catch immediately so Node doesn't log an Unhandled Rejection before we expect() it.
      const executePromise = service.executeTrigger('/path/hang.js', 'badTrigger', {});
      executePromise.catch(() => {});

      // Advance timers by 30 seconds to trigger the setTimeout AbortController
      await vi.advanceTimersByTimeAsync(30000);

      await expect(executePromise).rejects.toThrow('AbortError');
      expect(mockRun).toHaveBeenCalled();
    });
  });
});

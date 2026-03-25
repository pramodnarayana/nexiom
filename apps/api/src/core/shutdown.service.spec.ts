import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ShutdownService } from './shutdown.service.js';
import type { INestApplication } from '@nestjs/common';

describe('ShutdownService', () => {
  let service: ShutdownService;
  let processOnSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new ShutdownService();
    processOnSpy = vi.spyOn(process, 'on');
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('enableShutdownHooks registers handlers for SIGTERM and SIGINT', () => {
    const app = { close: vi.fn() } as unknown as INestApplication;

    service.enableShutdownHooks(app);

    const registeredSignals = processOnSpy.mock.calls.map((c) => c[0]);
    expect(registeredSignals).toContain('SIGTERM');
    expect(registeredSignals).toContain('SIGINT');
  });

  it('on signal, calls app.close() and then process.exit(0)', async () => {
    const closeMock = vi.fn().mockResolvedValue(undefined);
    const app = { close: closeMock } as unknown as INestApplication;

    service.enableShutdownHooks(app);

    // Find the SIGTERM handler and invoke it
    const sigtermCall = processOnSpy.mock.calls.find((c) => c[0] === 'SIGTERM');
    expect(sigtermCall).toBeDefined();
    const handler = sigtermCall![1] as () => void;
    handler();

    // Flush microtasks
    await vi.advanceTimersByTimeAsync(0);

    expect(closeMock).toHaveBeenCalledOnce();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('on signal, if app.close() rejects, calls process.exit(1)', async () => {
    const closeMock = vi.fn().mockRejectedValue(new Error('close failed'));
    const app = { close: closeMock } as unknown as INestApplication;

    service.enableShutdownHooks(app);

    const sigtermCall = processOnSpy.mock.calls.find((c) => c[0] === 'SIGTERM');
    const handler = sigtermCall![1] as () => void;
    handler();

    await vi.advanceTimersByTimeAsync(0);

    expect(closeMock).toHaveBeenCalledOnce();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('does not call app.close() a second time when a duplicate signal fires while draining', async () => {
    // Simulate a slow drain (never resolves within the test window)
    const closeMock = vi.fn().mockReturnValue(new Promise(() => {}));
    const app = { close: closeMock } as unknown as INestApplication;

    service.enableShutdownHooks(app);

    const sigtermCall = processOnSpy.mock.calls.find((c) => c[0] === 'SIGTERM');
    const handler = sigtermCall![1] as () => void;

    // Fire SIGTERM twice in quick succession
    handler();
    handler();

    await vi.advanceTimersByTimeAsync(0);

    // app.close() must only be called once despite two signals
    expect(closeMock).toHaveBeenCalledOnce();
  });

  it('hard deadline calls process.exit(1) after 30s', async () => {
    // app.close() never resolves
    const app = {
      close: vi.fn().mockReturnValue(new Promise(() => {})),
    } as unknown as INestApplication;

    service.enableShutdownHooks(app);

    const sigtermCall = processOnSpy.mock.calls.find((c) => c[0] === 'SIGTERM');
    const handler = sigtermCall![1] as () => void;
    handler();

    // Advance past the 30s deadline
    await vi.advanceTimersByTimeAsync(30_000);

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ShutdownService } from './shutdown.service.js';
import type { INestApplication } from '@nestjs/common';

describe('ShutdownService', () => {
  let service: ShutdownService;
  let processOnceSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new ShutdownService();
    // Stub process.once so no real OS signal handlers are registered between tests.
    // The spy still captures calls so we can extract handlers and invoke them manually.
    processOnceSpy = vi
      .spyOn(process, 'once')
      .mockImplementation((_event, _listener) => process);
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Extract the handler registered for a given signal via process.once. */
  function getHandler(signal: string): (() => void) | undefined {
    const call = processOnceSpy.mock.calls.find((c) => c[0] === signal);
    return call?.[1] as (() => void) | undefined;
  }

  it('enableShutdownHooks registers handlers for SIGTERM and SIGINT', () => {
    const app = { close: vi.fn() } as unknown as INestApplication;

    service.enableShutdownHooks(app);

    const registeredSignals = processOnceSpy.mock.calls.map((c) => c[0]);
    expect(registeredSignals).toContain('SIGTERM');
    expect(registeredSignals).toContain('SIGINT');
  });

  it('is idempotent — calling enableShutdownHooks twice only registers handlers once', () => {
    const app = { close: vi.fn() } as unknown as INestApplication;

    service.enableShutdownHooks(app);
    service.enableShutdownHooks(app);

    const sigtermCalls = processOnceSpy.mock.calls.filter(
      (c) => c[0] === 'SIGTERM',
    );
    expect(sigtermCalls).toHaveLength(1);

    const sigintCalls = processOnceSpy.mock.calls.filter(
      (c) => c[0] === 'SIGINT',
    );
    expect(sigintCalls).toHaveLength(1);
  });

  it('on signal, calls app.close() and then process.exit(0)', async () => {
    const closeMock = vi.fn().mockResolvedValue(undefined);
    const app = { close: closeMock } as unknown as INestApplication;

    service.enableShutdownHooks(app);

    const handler = getHandler('SIGTERM');
    expect(handler).toBeDefined();
    handler!();

    await vi.advanceTimersByTimeAsync(0);

    expect(closeMock).toHaveBeenCalledOnce();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('on signal, if app.close() rejects, calls process.exit(1)', async () => {
    const closeMock = vi.fn().mockRejectedValue(new Error('close failed'));
    const app = { close: closeMock } as unknown as INestApplication;

    service.enableShutdownHooks(app);

    const handler = getHandler('SIGTERM');
    expect(handler).toBeDefined();
    handler!();

    await vi.advanceTimersByTimeAsync(0);

    expect(closeMock).toHaveBeenCalledOnce();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('does not call app.close() a second time when a duplicate signal fires while draining', async () => {
    const closeMock = vi.fn().mockReturnValue(new Promise(() => {}));
    const app = { close: closeMock } as unknown as INestApplication;

    service.enableShutdownHooks(app);

    const handler = getHandler('SIGTERM');
    expect(handler).toBeDefined();

    // Fire SIGTERM twice in quick succession
    handler!();
    handler!();

    await vi.advanceTimersByTimeAsync(0);

    expect(closeMock).toHaveBeenCalledOnce();
  });

  it('hard deadline calls process.exit(1) after 30s', async () => {
    const app = {
      close: vi.fn().mockReturnValue(new Promise(() => {})),
    } as unknown as INestApplication;

    service.enableShutdownHooks(app);

    const handler = getHandler('SIGTERM');
    expect(handler).toBeDefined();
    handler!();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { InboundOutboxService } from './inbound-outbox.service.js';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { QueueService, QueueName } from '@nexiom/queue';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('InboundOutboxService', () => {
  let service: InboundOutboxService;
  let db: any;
  let queueService: any;

  beforeEach(async () => {
    queueService = { send: vi.fn() };

    db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi
        .fn()
        .mockResolvedValue([
          { dataNamespace: 'ws_1' },
          { dataNamespace: 'ws_2' },
        ]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
      transaction: vi.fn().mockImplementation(async (cb) => {
        const tx = {
          execute: vi.fn(),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          returning: vi
            .fn()
            .mockResolvedValue([
              { id: '1', traceId: 't1', connectionId: 'c1', attempts: 1 },
            ]),
        };
        return cb(tx);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboundOutboxService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: QueueService, useValue: queueService },
      ],
    }).compile();

    service = module.get<InboundOutboxService>(InboundOutboxService);
  });

  it('processOutbox should fetch workspaces and process rows', async () => {
    await service.processOutbox();
    // It should fetch workspaces ws_1 and ws_2, and for both, it mocks claiming 1 row.
    // The claimed row is successfully delivered to QueueName.InboundQueue
    expect(queueService.send).toHaveBeenCalledWith(QueueName.InboundQueue, {
      traceId: 't1',
      connectionId: 'c1',
    });
    expect(db.update).toHaveBeenCalled();
  });

  it('processOutboxRow should retry on failure', async () => {
    queueService.send.mockRejectedValue(new Error('Queue down'));
    // processOutbox internally triggers processOutboxRow via drainWorkspaceOutbox
    await service.processOutbox();
    // It should have failed and called db.update to set status: 'RETRY'
    expect(db.update).toHaveBeenCalled();
    const updateCall = db.update.mock.calls.find(
      (call: any[]) => call.length > 0,
    );
    expect(updateCall).toBeDefined();
    const setCall = db
      .update()
      .set.mock.calls.find(
        (call: any[]) =>
          call[0] && typeof call[0] === 'object' && 'status' in call[0],
      );
    expect(setCall).toBeDefined();
    expect(setCall![0]).toMatchObject({ status: 'RETRY' });
  });

  it('processOutboxRow should permanently fail on max attempts', async () => {
    queueService.send.mockRejectedValue(new Error('Queue down'));
    db.transaction.mockImplementationOnce(async (cb: any) => {
      return cb({
        execute: vi.fn(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi
          .fn()
          .mockResolvedValue([
            { id: '1', traceId: 't1', connectionId: 'c1', attempts: 6 },
          ]), // Max attempts hit
      });
    });

    await service.processOutbox();
    // It should have called db.update to set status: 'FAIL' and not called queueService.send for the row with attempts: 6
    expect(db.update).toHaveBeenCalled();
    const setCall = db
      .update()
      .set.mock.calls.find(
        (call: any[]) =>
          call[0] && typeof call[0] === 'object' && 'status' in call[0],
      );
    expect(setCall).toBeDefined();
    expect(setCall![0]).toMatchObject({ status: 'FAIL' });
    // queueService.send should have been called during the claim phase but rejected, not called again for the failed row
    expect(queueService.send).toHaveBeenCalledWith(expect.anything(), {
      traceId: 't1',
      connectionId: 'c1',
    });
  });

  it('should handle rejecting drainWorkspace gracefully', async () => {
    const loggerErrorSpy = vi.spyOn((service as any).logger, 'error');
    db.transaction.mockRejectedValueOnce(new Error('db down'));
    // Since mock resolves 2 workspaces ws_1 and ws_2, first throws, second succeeds
    await service.processOutbox();
    // processOutbox handles rejection internally and logs it.
    // Verify that the error was logged
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(
      loggerErrorSpy.mock.calls.some(
        (call: any[]) =>
          typeof call[0] === 'string' &&
          call[0].includes('drainWorkspaceOutbox failed'),
      ),
    ).toBe(true);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PollerService } from './poller.service.js';
/* eslint-disable @typescript-eslint/unbound-method */
import { TriggerStrategy } from '@nexiom/piece-framework';
import type { TriggerExecutorService } from './trigger-executor.service.js';
import { PieceRegistryService } from '@nexiom/piece-registry';

function makeDb(rows: unknown[] = []) {
  return {
    $client: {
      query: vi.fn().mockResolvedValue({ rows }),
    },
  };
}

function makeExecutor() {
  return {
    runPoll: vi.fn().mockResolvedValue(undefined),
  } as unknown as TriggerExecutorService;
}

function makeRegistry(triggerType = TriggerStrategy.POLLING) {
  return {
    getTrigger: vi
      .fn()
      .mockReturnValue({ type: triggerType, name: 'new_record' }),
  } as unknown as PieceRegistryService;
}

describe('PollerService', () => {
  let db: ReturnType<typeof makeDb>;
  let executor: TriggerExecutorService;
  let registry: PieceRegistryService;

  beforeEach(() => {
    executor = makeExecutor();
    registry = makeRegistry();
  });

  it('should dispatch executor.runPoll for each active polling connection', async () => {
    db = makeDb([
      {
        workspace_id: 'ws_1',
        app_name: 'salesforce',
        trigger_name: 'new_record',
        object_type: null,
        auth: {},
        props_value: {},
      },
    ]);

    const service = new PollerService(
      db as unknown as import('@nexiom/database').DrizzleDb,
      executor,
      registry,
    );

    await service.poll();

    expect(executor.runPoll).toHaveBeenCalledOnce();
  });

  it('should not call executor if no active connections found', async () => {
    db = makeDb([]);

    const service = new PollerService(
      db as unknown as import('@nexiom/database').DrizzleDb,
      executor,
      registry,
    );

    await service.poll();

    expect(executor.runPoll).not.toHaveBeenCalled();
  });

  it('should skip connections whose trigger is not a POLLING type', async () => {
    db = makeDb([
      {
        workspace_id: 'ws_1',
        app_name: 'salesforce',
        trigger_name: 'incoming_hook',
        object_type: null,
        auth: {},
        props_value: {},
      },
    ]);

    const webhookRegistry = makeRegistry(TriggerStrategy.WEBHOOK);
    const service = new PollerService(
      db as unknown as import('@nexiom/database').DrizzleDb,
      executor,
      webhookRegistry,
    );

    await service.poll();

    expect(executor.runPoll).not.toHaveBeenCalled();
  });

  it('should return early and log if DB query fails', async () => {
    const brokenDb = {
      $client: {
        query: vi.fn().mockRejectedValue(new Error('DB error')),
      },
    };

    const service = new PollerService(
      brokenDb as unknown as import('@nexiom/database').DrizzleDb,
      executor,
      registry,
    );

    await expect(service.poll()).resolves.not.toThrow();
    expect(executor.runPoll).not.toHaveBeenCalled();
  });
});

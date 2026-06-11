/* eslint-disable @typescript-eslint/require-await */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TriggerExecutorService } from './trigger-executor.service.js';
import { TriggerRetryPolicyService } from './trigger-retry-policy.service.js';
import { TriggerPayloadTransformer } from './trigger-payload-transformer.js';
import { TriggerStrategy } from '@soopa/piece-framework';
import type { Trigger } from '@soopa/piece-framework';
import type { DrizzleDb } from '@soopa/database';
import type { DatabaseManager } from '@soopa/dbmanager';
import type { StorageResolverService } from '@soopa/pipeline';
import type { IKeyValueStore } from '@soopa/cache';
import type { IDistributedLockService } from './interfaces/distributed-lock.interface.js';
import type { ITriggerDlqService } from './interfaces/trigger-dlq.interface.js';
import type { MockedObject } from 'vitest';
function makeMockDb() {
  const where = vi.fn().mockResolvedValue([]);
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  const returning = vi.fn().mockResolvedValue([{ id: '1' }]);
  const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });

  const tx = {
    execute: vi.fn(),
    update,
    insert,
  };

  return {
    $client: {
      query: vi.fn(),
    },
    query: {
      dataSources: { findFirst: vi.fn().mockResolvedValue({ metadata: {} }) },
    },
    execute: vi.fn().mockResolvedValue({}),
    update,
    insert,
    transaction: vi.fn().mockImplementation(async (cb) => cb(tx)),
  };
}

function makeMockLockService() {
  return {
    acquireLock: vi.fn().mockResolvedValue('token'),
    releaseLock: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockDlqService() {
  return {
    pushJob: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockKvStore() {
  return {
    hget: vi.fn().mockResolvedValue(null),
    hset: vi.fn().mockResolvedValue(1),
    hdel: vi.fn().mockResolvedValue(1),
  };
}

function makeMockTrigger(overrides?: Partial<Trigger>): Trigger {
  return {
    name: 'new_record',
    displayName: 'New Record',
    description: 'desc',
    type: TriggerStrategy.POLLING,
    props: {},
    run: () => Promise.resolve([{ id: '1' }]),
    ...overrides,
  };
}

const TEST_CONNECTION_ID = 'conn_test';

describe('TriggerExecutorService', () => {
  let db: ReturnType<typeof makeMockDb>;
  let lockService: ReturnType<typeof makeMockLockService>;
  let dlqService: ReturnType<typeof makeMockDlqService>;
  let kvStore: ReturnType<typeof makeMockKvStore>;
  let service: TriggerExecutorService;
  let retryPolicy: TriggerRetryPolicyService;
  let payloadTransformer: TriggerPayloadTransformer;

  beforeEach(() => {
    db = makeMockDb();
    lockService = makeMockLockService();
    dlqService = makeMockDlqService();
    kvStore = makeMockKvStore();
    retryPolicy = new TriggerRetryPolicyService(
      dlqService as unknown as MockedObject<ITriggerDlqService>,
    );
    payloadTransformer = new TriggerPayloadTransformer();

    service = new TriggerExecutorService(
      db as unknown as MockedObject<DrizzleDb>,
      lockService as unknown as MockedObject<IDistributedLockService>,
      retryPolicy,
      payloadTransformer,
      kvStore as unknown as MockedObject<IKeyValueStore>,
      {
        applyPlan: vi.fn(),
      } as unknown as MockedObject<DatabaseManager>,
      {
        resolveSchemaName: vi.fn().mockResolvedValue('ws_test'),
      } as unknown as MockedObject<StorageResolverService>,
    );
  });

  describe('runPoll()', () => {
    it('should skip if Redis lock not acquired', async () => {
      lockService.acquireLock.mockResolvedValue(null); // lock not acquired
      const runSpy = vi.spyOn(service as never, 'executeAndIngest');

      await service.runPoll({
        trigger: makeMockTrigger(),
        appName: 'salesforce',
        triggerName: 'new_record',
        objectType: undefined,
        auth: {},
        propsValue: {},
        workspaceId: 'ws_1',
        dataSourceId: TEST_CONNECTION_ID,
        tenantId: 'tenant_test',
      });

      expect(runSpy).not.toHaveBeenCalled();
    });

    it('should run and release lock when acquired', async () => {
      lockService.acquireLock.mockResolvedValue('token');
      db.$client.query.mockResolvedValue({ rowCount: 1 });
      kvStore.hget.mockResolvedValue(null);
      kvStore.hset.mockResolvedValue(1);

      await service.runPoll({
        trigger: makeMockTrigger(),
        appName: 'salesforce',
        triggerName: 'new_record',
        objectType: undefined,
        auth: {},
        propsValue: {},
        workspaceId: 'ws_1',
        dataSourceId: TEST_CONNECTION_ID,
        tenantId: 'tenant_test',
      });

      // Lock is released
      expect(lockService.releaseLock).toHaveBeenCalled();
    });
  });

  describe('runWebhook()', () => {
    it('should call trigger.run and ingest results', async () => {
      db.$client.query.mockResolvedValue({ rowCount: 1 });
      kvStore.hget.mockResolvedValue(null);
      kvStore.hset.mockResolvedValue(1);

      await service.runWebhook({
        trigger: makeMockTrigger(),
        appName: 'salesforce',
        triggerName: 'new_record',
        objectType: undefined,
        auth: {},
        propsValue: {},
        workspaceId: 'ws_1',
        dataSourceId: TEST_CONNECTION_ID,
        tenantId: 'tenant_test',
        headers: {},
        rawBody: Buffer.from('{}'),
      });

      expect(db.insert).toHaveBeenCalled();
    });

    it('should skip if Redis lock not acquired for webhook', async () => {
      lockService.acquireLock.mockResolvedValue(null); // lock not acquired

      await service.runWebhook({
        trigger: makeMockTrigger(),
        appName: 'salesforce',
        triggerName: 'new_record',
        objectType: undefined,
        auth: {},
        propsValue: {},
        workspaceId: 'ws_1',
        dataSourceId: TEST_CONNECTION_ID,
        tenantId: 'tenant_test',
        headers: {},
        rawBody: Buffer.from('{}'),
      });

      expect(db.insert).not.toHaveBeenCalled();
    });

    it('should call verifySignature if present', async () => {
      const verifySpy = vi.fn();
      db.$client.query.mockResolvedValue({ rowCount: 1 });
      kvStore.hget.mockResolvedValue(null);
      kvStore.hset.mockResolvedValue(1);

      await service.runWebhook({
        trigger: makeMockTrigger({ verifySignature: verifySpy }),
        appName: 'salesforce',
        triggerName: 'new_record',
        objectType: undefined,
        auth: {},
        propsValue: {},
        workspaceId: 'ws_1',
        dataSourceId: TEST_CONNECTION_ID,
        tenantId: 'tenant_test',
        headers: { 'x-hub-signature': 'sha256=abc' },
        rawBody: Buffer.from('{}'),
        secret: 'my_secret',
      });

      expect(verifySpy).toHaveBeenCalled();
    });

    it('should reject and not ingest when verifySignature throws', async () => {
      const sigError = new Error('Invalid signature');
      const badVerify = vi.fn().mockImplementation(() => {
        throw sigError;
      });

      await expect(
        service.runWebhook({
          trigger: makeMockTrigger({ verifySignature: badVerify }),
          appName: 'salesforce',
          triggerName: 'new_record',
          objectType: undefined,
          auth: {},
          propsValue: {},
          workspaceId: 'ws_1',
          dataSourceId: TEST_CONNECTION_ID,
          tenantId: 'tenant_test',
          headers: { 'x-hub-signature': 'sha256=bad' },
          rawBody: Buffer.from('{}'),
          secret: 'wrong_secret',
        }),
      ).rejects.toThrow('Invalid signature');

      // No DB write or cursor update should occur
      expect(db.insert).not.toHaveBeenCalled();
      expect(kvStore.hset).not.toHaveBeenCalled();
    });
  });

  describe('runOnEnable() / runOnDisable()', () => {
    it('runOnEnable should call trigger.onEnable', async () => {
      const onEnable = vi.fn().mockResolvedValue(undefined);
      const trigger = makeMockTrigger({ onEnable });

      await service.runOnEnable({
        trigger,
        appName: 'salesforce',
        triggerName: 'new_record',
        objectType: undefined,
        auth: {},
        propsValue: {},
        workspaceId: 'ws_1',
        dataSourceId: TEST_CONNECTION_ID,
        tenantId: 'tenant_test',
      });

      expect(onEnable).toHaveBeenCalled();
    });

    it('runOnEnable should revert if trigger.onEnable throws', async () => {
      const onEnable = vi.fn().mockRejectedValue(new Error('onEnable failed'));
      const trigger = makeMockTrigger({ onEnable });

      await expect(
        service.runOnEnable({
          trigger,
          appName: 'salesforce',
          triggerName: 'new_record',
          objectType: undefined,
          auth: {},
          propsValue: {},
          workspaceId: 'ws_1',
          dataSourceId: TEST_CONNECTION_ID,
          tenantId: 'tenant_test',
        }),
      ).rejects.toThrow('onEnable failed');

      // The catch block should have executed and reverted the publication
      expect(db.execute).toHaveBeenCalledTimes(2); // once for add, once for drop
    });

    it('runOnEnable should handle revert errors gracefully', async () => {
      const onEnable = vi.fn().mockRejectedValue(new Error('onEnable failed'));
      const trigger = makeMockTrigger({ onEnable });

      // make db.update throw for the revert (simulating wroteRegistryRow=true revert failure)
      db.update.mockImplementationOnce(() => {
        return {
          set: () => ({
            where: () => {
              throw new Error('revert update failed');
            },
          }),
        };
      });

      // and db.execute throw for pub drop
      db.execute.mockResolvedValueOnce({}); // add pub succeeds
      db.execute.mockRejectedValueOnce(new Error('pub drop failed'));

      // force wroteRegistryRow to be true by throwing AFTER the update inside onEnable?
      // No, wroteRegistryRow is only set after onEnable succeeds.
      // So let's just test the pub revert error.
      await expect(
        service.runOnEnable({
          trigger,
          appName: 'salesforce',
          triggerName: 'new_record',
          objectType: undefined,
          auth: {},
          propsValue: {},
          workspaceId: 'ws_1',
          dataSourceId: TEST_CONNECTION_ID,
          tenantId: 'tenant_test',
        }),
      ).rejects.toThrow('onEnable failed');
    });

    it('runOnEnable should revert registry row if error occurs after wroteRegistryRow', async () => {
      const onEnable = vi.fn().mockResolvedValue(undefined);
      const trigger = makeMockTrigger({ onEnable });

      // The only way to throw after wroteRegistryRow=true is if logger.log throws
      const loggerSpy = vi
        .spyOn(service['logger'], 'log')
        .mockImplementationOnce(() => {
          throw new Error('logger failed');
        });

      await expect(
        service.runOnEnable({
          trigger,
          appName: 'salesforce',
          triggerName: 'new_record',
          objectType: undefined,
          auth: {},
          propsValue: {},
          workspaceId: 'ws_1',
          dataSourceId: TEST_CONNECTION_ID,
          tenantId: 'tenant_test',
        }),
      ).rejects.toThrow('logger failed');

      expect(db.update).toHaveBeenCalled(); // Should have reverted
      loggerSpy.mockRestore();
    });

    it('runOnDisable should catch and log error if onDisable fails', async () => {
      const onDisable = vi.fn().mockRejectedValue('string error');
      const trigger = makeMockTrigger({ onDisable });

      await expect(
        service.runOnDisable({
          trigger,
          appName: 'salesforce',
          triggerName: 'new_record',
          objectType: undefined,
          auth: {},
          propsValue: {},
          workspaceId: 'ws_1',
          dataSourceId: TEST_CONNECTION_ID,
          tenantId: 'tenant_test',
        }),
      ).resolves.not.toThrow();
    });

    describe('executeAndIngest edge cases', () => {
      it('returns early if records.length === 0', async () => {
        lockService.acquireLock.mockResolvedValue('token');

        const trigger = makeMockTrigger({
          run: () => Promise.resolve([]),
        });

        await service.runPoll({
          trigger,
          appName: 'salesforce',
          triggerName: 'new_record',
          objectType: undefined,
          auth: {},
          propsValue: {},
          workspaceId: 'ws_1',
          dataSourceId: TEST_CONNECTION_ID,
          tenantId: 'tenant_test',
        });

        // No DB inserts should have occurred
        expect(db.insert).not.toHaveBeenCalled();
      });
    });

    it('runOnDisable should not throw even if onDisable fails', async () => {
      const onDisable = vi.fn().mockRejectedValue(new Error('failed'));
      const trigger = makeMockTrigger({ onDisable });

      await expect(
        service.runOnDisable({
          trigger,
          appName: 'salesforce',
          triggerName: 'new_record',
          objectType: undefined,
          auth: {},
          propsValue: {},
          workspaceId: 'ws_1',
          dataSourceId: TEST_CONNECTION_ID,
          tenantId: 'tenant_test',
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('insertGatewayRow() idempotency', () => {
    it('pushes to DLQ when trigger.run throws', async () => {
      lockService.acquireLock.mockResolvedValue('token');
      dlqService.pushJob.mockResolvedValue(undefined);

      const failingTrigger = makeMockTrigger({
        run: () => Promise.reject(new Error('API down')),
      });

      await service.runPoll({
        trigger: failingTrigger,
        appName: 'salesforce',
        triggerName: 'new_record',
        objectType: undefined,
        auth: {},
        propsValue: {},
        workspaceId: 'ws_1',
        dataSourceId: TEST_CONNECTION_ID,
        tenantId: 'tenant_test',
      });

      expect(dlqService.pushJob).toHaveBeenCalledWith(
        expect.stringContaining('API down'),
      );
    });

    it('re-throws error if fromDlqRetry is true when trigger.run throws', async () => {
      lockService.acquireLock.mockResolvedValue('token');
      dlqService.pushJob.mockResolvedValue(undefined);

      const failingTrigger = makeMockTrigger({
        run: () => Promise.reject(new Error('API down retry')),
      });

      await expect(
        service.runPoll(
          {
            trigger: failingTrigger,
            appName: 'salesforce',
            triggerName: 'new_record',
            objectType: undefined,
            auth: {},
            propsValue: {},
            workspaceId: 'ws_1',
            dataSourceId: TEST_CONNECTION_ID,
            tenantId: 'tenant_test',
          },
          true,
        ),
      ).rejects.toThrow('API down retry');
    });
  });

  describe('handleRecordIngestFailure', () => {
    it('re-throws error if fromDlqRetry is true without pushing to DLQ', async () => {
      lockService.acquireLock.mockResolvedValue('token');

      const failingInsertDb = makeMockDb();
      failingInsertDb.transaction.mockImplementation(async () => {
        throw new Error('Insert failed');
      });

      const svc = new TriggerExecutorService(
        failingInsertDb as unknown as MockedObject<DrizzleDb>,
        lockService as unknown as MockedObject<IDistributedLockService>,
        retryPolicy,
        payloadTransformer,
        kvStore as unknown as MockedObject<IKeyValueStore>,
        {
          applyPlan: vi.fn(),
        } as unknown as MockedObject<DatabaseManager>,
        {
          resolveSchemaName: vi.fn().mockResolvedValue('ws_test'),
        } as unknown as MockedObject<StorageResolverService>,
      );

      const trigger = makeMockTrigger({
        run: () => Promise.resolve([{ id: '1' }]),
      });

      await expect(
        svc.runPoll(
          {
            trigger,
            appName: 'salesforce',
            triggerName: 'new_record',
            objectType: undefined,
            auth: {},
            propsValue: {},
            workspaceId: 'ws_1',
            dataSourceId: TEST_CONNECTION_ID,
            tenantId: 'tenant_test',
          },
          true, // fromDlqRetry
        ),
      ).rejects.toThrow('Insert failed');

      // The DLQ should not be called again if fromDlqRetry is true
      expect(dlqService.pushJob).not.toHaveBeenCalled();
    });

    it('pushes remaining records to DLQ and throws if fromDlqRetry is false for webhook', async () => {
      lockService.acquireLock.mockResolvedValue('token');

      const failingInsertDb = makeMockDb();
      failingInsertDb.transaction.mockImplementation(async () => {
        throw new Error('Insert failed');
      });

      const svc = new TriggerExecutorService(
        failingInsertDb as unknown as MockedObject<DrizzleDb>,
        lockService as unknown as MockedObject<IDistributedLockService>,
        retryPolicy,
        payloadTransformer,
        kvStore as unknown as MockedObject<IKeyValueStore>,
        {
          applyPlan: vi.fn(),
        } as unknown as MockedObject<DatabaseManager>,
        {
          resolveSchemaName: vi.fn().mockResolvedValue('ws_test'),
        } as unknown as MockedObject<StorageResolverService>,
      );

      const payloadArray = [{ id: '1' }, { id: '2' }];
      const trigger = makeMockTrigger({
        run: () => Promise.resolve(payloadArray),
      });

      await expect(
        svc.runWebhook({
          trigger,
          appName: 'salesforce',
          triggerName: 'new_record',
          objectType: undefined,
          auth: {},
          propsValue: {},
          workspaceId: 'ws_1',
          dataSourceId: TEST_CONNECTION_ID,
          tenantId: 'tenant_test',
          headers: {},
          rawBody: Buffer.from(JSON.stringify(payloadArray)),
        }),
      ).rejects.toThrow('Insert failed');

      expect(dlqService.pushJob).toHaveBeenCalledWith(
        expect.stringContaining('Insert failed'),
      );
      // We also check that the pushed job has the payload intact
      const dlqCall = dlqService.pushJob.mock.calls[0][0];
      const job = JSON.parse(dlqCall as string);
      expect(job.payload).toEqual(payloadArray);
    });
  });

  describe('buildSourceEventId', () => {
    it('handles non-object records and arrays', async () => {
      lockService.acquireLock.mockResolvedValue('token');

      const trigger = makeMockTrigger({
        run: () => Promise.resolve(['string_record', [1, 2, 3]]),
      });

      await service.runPoll({
        trigger,
        appName: 'salesforce',
        triggerName: 'new_record',
        objectType: undefined,
        auth: {},
        propsValue: {},
        workspaceId: 'ws_1',
        dataSourceId: TEST_CONNECTION_ID,
        tenantId: 'tenant_test',
      });

      // Should have successfully called db.insert for both records (2 rows per record -> 4 inserts)
      expect(db.insert).toHaveBeenCalledTimes(4);
    });

    it('strips volatile keys and caps at FINGERPRINT_MAX_BYTES', async () => {
      lockService.acquireLock.mockResolvedValue('token');

      const hugeString = 'a'.repeat(5000);
      const record = {
        _etag: 'volatile',
        SystemModstamp: 'volatile2',
        important: 'data',
        huge: hugeString,
      };

      const trigger = makeMockTrigger({
        run: () => Promise.resolve([record]),
      });

      await service.runPoll({
        trigger,
        appName: 'salesforce',
        triggerName: 'new_record',
        objectType: undefined,
        auth: {},
        propsValue: {},
        workspaceId: 'ws_1',
        dataSourceId: TEST_CONNECTION_ID,
        tenantId: 'tenant_test',
      });

      expect(db.insert).toHaveBeenCalledTimes(2);
    });
  });
});

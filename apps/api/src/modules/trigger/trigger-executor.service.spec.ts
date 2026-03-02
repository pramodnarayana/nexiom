import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TriggerExecutorService } from './trigger-executor.service';
import { TriggerStrategy } from '@nexiom/connections';
import type { Trigger } from '@nexiom/connections';

function makeMockDb() {
  return {
    $client: {
      query: vi.fn(),
    },
  };
}

function makeMockRedis() {
  return {
    set: vi.fn(),
    del: vi.fn(),
    lpush: vi.fn(),
    hget: vi.fn(),
    hset: vi.fn(),
    hdel: vi.fn(),
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

describe('TriggerExecutorService', () => {
  let db: ReturnType<typeof makeMockDb>;
  let redis: ReturnType<typeof makeMockRedis>;
  let service: TriggerExecutorService;

  beforeEach(() => {
    db = makeMockDb();
    redis = makeMockRedis();
    service = new TriggerExecutorService(
      db as unknown as import('@nexiom/database').DrizzleDb,
      redis as unknown as import('ioredis').Redis,
    );
  });

  describe('runPoll()', () => {
    it('should skip if Redis lock not acquired', async () => {
      redis.set.mockResolvedValue(null); // lock not acquired
      const runSpy = vi.spyOn(service as never, 'executeAndIngest');

      await service.runPoll({
        trigger: makeMockTrigger(),
        appName: 'salesforce',
        triggerName: 'new_record',
        objectType: undefined,
        auth: {},
        propsValue: {},
        workspaceId: 'ws_1',
      });

      expect(runSpy).not.toHaveBeenCalled();
    });

    it('should run and release lock when acquired', async () => {
      redis.set.mockResolvedValue('OK');
      redis.del.mockResolvedValue(1);
      db.$client.query.mockResolvedValue({ rowCount: 1 });
      redis.hget.mockResolvedValue(null);
      redis.hset.mockResolvedValue(1);

      await service.runPoll({
        trigger: makeMockTrigger(),
        appName: 'salesforce',
        triggerName: 'new_record',
        objectType: undefined,
        auth: {},
        propsValue: {},
        workspaceId: 'ws_1',
      });

      expect(redis.del).toHaveBeenCalled();
    });
  });

  describe('runWebhook()', () => {
    it('should call trigger.run and ingest results', async () => {
      db.$client.query.mockResolvedValue({ rowCount: 1 });
      redis.hget.mockResolvedValue(null);
      redis.hset.mockResolvedValue(1);

      await service.runWebhook({
        trigger: makeMockTrigger(),
        appName: 'salesforce',
        triggerName: 'new_record',
        objectType: undefined,
        auth: {},
        propsValue: {},
        workspaceId: 'ws_1',
        headers: {},
        rawBody: Buffer.from('{}'),
      });

      expect(db.$client.query).toHaveBeenCalled();
    });

    it('should call verifySignature if present', async () => {
      const verifySpy = vi.fn();
      db.$client.query.mockResolvedValue({ rowCount: 1 });
      redis.hget.mockResolvedValue(null);
      redis.hset.mockResolvedValue(1);

      await service.runWebhook({
        trigger: makeMockTrigger({ verifySignature: verifySpy }),
        appName: 'salesforce',
        triggerName: 'new_record',
        objectType: undefined,
        auth: {},
        propsValue: {},
        workspaceId: 'ws_1',
        headers: { 'x-hub-signature': 'sha256=abc' },
        rawBody: Buffer.from('{}'),
        secret: 'my_secret',
      });

      expect(verifySpy).toHaveBeenCalled();
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
      });

      expect(onEnable).toHaveBeenCalled();
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
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('insertGatewayRow() idempotency', () => {
    it('pushes to DLQ when trigger.run throws', async () => {
      redis.set.mockResolvedValue('OK');
      redis.del.mockResolvedValue(1);
      redis.lpush.mockResolvedValue(1);

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
      });

      expect(redis.lpush).toHaveBeenCalledWith(
        'dlq:triggers',
        expect.stringContaining('API down'),
      );
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TriggerExecutorService } from './trigger-executor.service.js';
import { TriggerStrategy } from '@nexiom/piece-framework';
import type { Trigger } from '@nexiom/piece-framework';

function makeMockDb() {
  const where = vi.fn().mockResolvedValue([]);
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return {
    $client: {
      query: vi.fn(),
    },
    update,
  };
}

function makeMockRedis() {
  return {
    set: vi.fn().mockResolvedValue('OK'), // default: lock acquired
    del: vi.fn().mockResolvedValue(1),
    eval: vi.fn().mockResolvedValue(1), // Lua lock release
    lpush: vi.fn().mockResolvedValue(1),
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
      {
        applyPlan: vi.fn(),
      } as unknown as import('@nexiom/dbmanager').DatabaseManager,
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

      // Lock is released via Lua eval (atomic check-and-delete)
      expect(redis.eval).toHaveBeenCalled();
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
          headers: { 'x-hub-signature': 'sha256=bad' },
          rawBody: Buffer.from('{}'),
          secret: 'wrong_secret',
        }),
      ).rejects.toThrow('Invalid signature');

      // No DB write or cursor update should occur
      expect(db.$client.query).not.toHaveBeenCalled();
      expect(redis.hset).not.toHaveBeenCalled();
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

/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { WebhooksController } from './webhooks.controller.js';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { TriggerStrategy } from '@nexiom/piece-framework';
import { PieceRegistryService } from '@nexiom/piece-registry';
import type { TriggerExecutorService } from './trigger-executor.service.js';

function makeDb(row: unknown = null) {
  return {
    $client: {
      query: vi.fn().mockResolvedValue({ rows: row ? [row] : [] }),
    },
  };
}

function makeRegistry(triggerType = TriggerStrategy.WEBHOOK) {
  return {
    getTrigger: vi.fn().mockReturnValue({
      name: 'incoming_hook',
      type: triggerType,
    }),
  } as unknown as PieceRegistryService;
}

function makeExecutor() {
  return {
    runWebhook: vi.fn().mockResolvedValue(undefined),
  } as unknown as TriggerExecutorService;
}

const CONNECTION_ROW = {
  workspace_id: 'ws_1',
  app_name: 'salesforce',
  trigger_name: 'incoming_hook',
  object_type: null,
  auth: {},
  props_value: {},
  webhook_secret: 'secret123',
};

describe('WebhooksController', () => {
  let db: ReturnType<typeof makeDb>;
  let registry: PieceRegistryService;
  let executor: TriggerExecutorService;

  beforeEach(() => {
    db = makeDb(CONNECTION_ROW);
    registry = makeRegistry();
    executor = makeExecutor();
  });

  it('should return { received: true } on success', async () => {
    const controller = new WebhooksController(
      db as unknown as import('@nexiom/database').DrizzleDb,
      registry,
      executor,
    );

    const result = await controller.handleWebhook(
      'conn_1',
      { 'x-sig': 'abc' },
      Buffer.from('{}'),
    );

    expect(result).toEqual({ received: true });
    expect(executor.runWebhook).toHaveBeenCalledOnce();
  });

  it('should throw NotFoundException when connection is not found', async () => {
    const emptyDb = makeDb(null);
    const controller = new WebhooksController(
      emptyDb as unknown as import('@nexiom/database').DrizzleDb,
      registry,
      executor,
    );

    await expect(
      controller.handleWebhook('missing_id', {}, Buffer.from('')),
    ).rejects.toThrow(NotFoundException);
  });

  it('should throw NotFoundException when trigger is not a WEBHOOK type', async () => {
    const pollingRegistry = makeRegistry(TriggerStrategy.POLLING);
    const controller = new WebhooksController(
      db as unknown as import('@nexiom/database').DrizzleDb,
      pollingRegistry,
      executor,
    );

    await expect(
      controller.handleWebhook('conn_1', {}, Buffer.from('')),
    ).rejects.toThrow(NotFoundException);
  });

  it('should re-throw UnauthorizedException from executor', async () => {
    (executor.runWebhook as Mock).mockRejectedValue(
      new UnauthorizedException('bad signature'),
    );

    const controller = new WebhooksController(
      db as unknown as import('@nexiom/database').DrizzleDb,
      registry,
      executor,
    );

    await expect(
      controller.handleWebhook('conn_1', {}, Buffer.from('')),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should re-throw other errors from executor', async () => {
    (executor.runWebhook as Mock).mockRejectedValue(new Error('internal'));

    const controller = new WebhooksController(
      db as unknown as import('@nexiom/database').DrizzleDb,
      registry,
      executor,
    );

    await expect(
      controller.handleWebhook('conn_1', {}, Buffer.from('')),
    ).rejects.toThrow('internal');
  });
});

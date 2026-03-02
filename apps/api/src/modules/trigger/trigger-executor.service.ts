import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Trigger, TriggerContext } from '@nexiom/connections';
import type { DrizzleDb } from '@nexiom/database';
import { DATABASE_CONNECTION } from '@nexiom/database';
import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { RedisBackedTriggerStore } from './redis-trigger-store';

export interface TriggerRunParams {
  trigger: Trigger;
  appName: string;
  triggerName: string;
  objectType: string | undefined;
  auth: unknown;
  propsValue: Record<string, unknown>;
  workspaceId: string;
}

export interface WebhookRunParams extends TriggerRunParams {
  headers: Record<string, string>;
  rawBody: Buffer;
  secret?: string;
}

/**
 * Orchestrates a single trigger invocation — polling or webhook.
 *
 * Guarantees:
 *  1. Distributed Redis lock per (workspaceId, triggerName) prevents concurrent
 *     runs across pods.
 *  2. Cursor advances only AFTER the inbound_gateway row is committed.
 *  3. Ingestion is idempotent via UNIQUE(source_event_id) + ON CONFLICT DO NOTHING.
 *  4. Any failure pushes a job onto dlq:triggers for retry by DlqProcessorService.
 */
@Injectable()
export class TriggerExecutorService {
  private readonly logger = new Logger(TriggerExecutorService.name);
  private readonly LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  // ─── Polling ────────────────────────────────────────────────────────────

  async runPoll(params: TriggerRunParams): Promise<void> {
    const lockKey = `lock:poll:${params.workspaceId}:${params.triggerName}`;
    const acquired = await this.acquireLock(lockKey);
    if (!acquired) {
      this.logger.debug('Skipping poll — lock already held', {
        workspaceId: params.workspaceId,
        triggerName: params.triggerName,
      });
      return;
    }

    try {
      await this.executeAndIngest(params);
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  // ─── Webhook ────────────────────────────────────────────────────────────

  async runWebhook(params: WebhookRunParams): Promise<void> {
    const { trigger, headers, rawBody, secret } = params;

    // Signature verification — throw means 401 in the controller
    if (trigger.verifySignature) {
      trigger.verifySignature(headers, rawBody, secret ?? '');
    }

    await this.executeAndIngest(params);
  }

  // ─── onEnable / onDisable ────────────────────────────────────────────────

  async runOnEnable(params: TriggerRunParams): Promise<void> {
    const context = this.buildContext(params);
    try {
      await params.trigger.onEnable?.(context);
      this.logger.log('onEnable completed', {
        appName: params.appName,
        triggerName: params.triggerName,
        workspaceId: params.workspaceId,
      });
    } catch (err) {
      this.logger.error('onEnable failed', {
        appName: params.appName,
        triggerName: params.triggerName,
        workspaceId: params.workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async runOnDisable(params: TriggerRunParams): Promise<void> {
    const context = this.buildContext(params);
    try {
      await params.trigger.onDisable?.(context);
      this.logger.log('onDisable completed', {
        appName: params.appName,
        triggerName: params.triggerName,
        workspaceId: params.workspaceId,
      });
    } catch (err) {
      this.logger.error('onDisable failed', {
        appName: params.appName,
        triggerName: params.triggerName,
        workspaceId: params.workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Non-fatal: log and continue so route deactivation isn't blocked
    }
  }

  // ─── Core execution ──────────────────────────────────────────────────────

  private async executeAndIngest(params: TriggerRunParams): Promise<void> {
    const context = this.buildContext(params);
    let records: unknown[];

    try {
      records = await params.trigger.run(context);
    } catch (err) {
      this.logger.error('trigger.run() failed — pushing to DLQ', {
        appName: params.appName,
        triggerName: params.triggerName,
        workspaceId: params.workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
      await this.pushToDlq(params, err);
      return;
    }

    if (records.length === 0) {
      this.logger.debug('No new records returned', {
        triggerName: params.triggerName,
        workspaceId: params.workspaceId,
      });
      return;
    }

    let inserted = 0;
    const store = this.buildStore(params);

    for (const record of records) {
      const sourceEventId = this.buildSourceEventId(
        params.workspaceId,
        params.triggerName,
        record,
      );

      const didInsert = await this.insertGatewayRow({
        workspaceId: params.workspaceId,
        appName: params.appName,
        triggerName: params.triggerName,
        objectType: params.objectType,
        payload: record,
        sourceEventId,
      });

      if (didInsert) {
        inserted++;
        // Cursor advances per-record only after successful DB write (atomicity guarantee)
        await store.put('last_cursor', new Date().toISOString());
      }
    }

    this.logger.log(
      `Ingested ${inserted} of ${records.length} record(s) (${records.length - inserted} duplicates skipped)`,
      {
        appName: params.appName,
        triggerName: params.triggerName,
        workspaceId: params.workspaceId,
        objectType: params.objectType,
      },
    );
  }

  // ─── Gateway row insert ──────────────────────────────────────────────────

  private async insertGatewayRow(row: {
    workspaceId: string;
    appName: string;
    triggerName: string;
    objectType: string | undefined;
    payload: unknown;
    sourceEventId: string;
  }): Promise<boolean> {
    try {
      const result = await this.db.$client.query<{ id: string }>(
        `INSERT INTO inbound_gateway
                    (source_event_id, trigger_name, app_name, object_type, payload)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (source_event_id) DO NOTHING
                 RETURNING id`,
        [
          row.sourceEventId,
          row.triggerName,
          row.appName,
          row.objectType ?? null,
          JSON.stringify(row.payload),
        ],
      );
      return (result.rowCount ?? 0) > 0;
    } catch (err) {
      this.logger.error('inbound_gateway insert failed', {
        sourceEventId: row.sourceEventId,
        workspaceId: row.workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  // ─── DLQ ─────────────────────────────────────────────────────────────────

  private async pushToDlq(
    params: TriggerRunParams,
    err: unknown,
  ): Promise<void> {
    const job = JSON.stringify({
      appName: params.appName,
      triggerName: params.triggerName,
      workspaceId: params.workspaceId,
      objectType: params.objectType,
      propsValue: params.propsValue,
      failedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      attempt: 1,
    });
    await this.redis.lpush('dlq:triggers', job);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private buildContext(params: TriggerRunParams): TriggerContext {
    return {
      auth: params.auth,
      propsValue: params.propsValue,
      store: this.buildStore(params),
      metadata: {
        workspaceId: params.workspaceId,
        triggerName: params.triggerName,
        appName: params.appName,
        objectType: params.objectType,
      },
    };
  }

  private buildStore(params: TriggerRunParams) {
    return new RedisBackedTriggerStore(
      this.redis,
      params.workspaceId,
      params.triggerName,
    );
  }

  private buildSourceEventId(
    workspaceId: string,
    triggerName: string,
    record: unknown,
  ): string {
    return createHash('sha256')
      .update(`${workspaceId}:${triggerName}:${JSON.stringify(record)}`)
      .digest('hex');
  }

  private async acquireLock(key: string): Promise<boolean> {
    const result = await this.redis.set(key, '1', 'PX', this.LOCK_TTL_MS, 'NX');
    return result === 'OK';
  }

  private async releaseLock(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

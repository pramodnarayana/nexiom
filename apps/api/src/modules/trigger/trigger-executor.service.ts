import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Trigger, TriggerContext } from '@nexiom/connections';
import type { DrizzleDb } from '@nexiom/database';
import { DATABASE_CONNECTION } from '@nexiom/database';
import type { Redis } from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import { RedisBackedTriggerStore } from './redis-trigger-store';

/**
 * Extracts a cursor value from a trigger record.
 *
 * Checks, in order: LastModifiedDate, _cursor, CreatedDate.
 * Falls back to the current ISO timestamp only when none of those fields exist.
 * Using the record's own timestamp avoids server clock skew against the source API.
 */
function extractRecordCursor(record: unknown): string {
  if (record !== null && typeof record === 'object') {
    const r = record as Record<string, unknown>;
    for (const key of ['LastModifiedDate', '_cursor', 'CreatedDate']) {
      if (typeof r[key] === 'string' && r[key]) return r[key];
    }
  }
  return new Date().toISOString();
}

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
  /** Parsed webhook body — populated in TriggerContext.payload for trigger logic. */
  payload?: unknown;
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

  /**
   * @param fromDlqRetry When true the caller is the DLQ processor retrying a
   *   previously failed job. Any trigger.run() failure is re-thrown so the DLQ
   *   processor can increment the attempt counter and schedule a delayed retry.
   *   When false (normal poller path) failures are pushed as a new DLQ job.
   */
  async runPoll(
    params: TriggerRunParams,
    fromDlqRetry = false,
  ): Promise<boolean> {
    const lockKey = `lock:poll:${params.workspaceId}:${params.triggerName}`;
    const token = await this.acquireLock(lockKey);
    if (!token) {
      this.logger.debug('Skipping poll — lock already held', {
        workspaceId: params.workspaceId,
        triggerName: params.triggerName,
      });
      return false; // lock contention — caller should requeue
    }

    try {
      await this.executeAndIngest(params, fromDlqRetry);
      return true;
    } finally {
      await this.releaseLock(lockKey, token);
    }
  }

  // ─── Webhook ────────────────────────────────────────────────────────────

  async runWebhook(params: WebhookRunParams): Promise<void> {
    const { trigger, headers, rawBody, secret } = params;

    // Signature verification — throw means 401 in the controller
    if (trigger.verifySignature) {
      trigger.verifySignature(headers, rawBody, secret ?? '');
    }

    // Parse the raw body so TriggerContext.payload is populated for trigger logic.
    // Falls back to the raw buffer if JSON parsing fails (e.g. plain-text hooks).
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf-8')) as unknown;
    } catch {
      payload = rawBody;
    }

    await this.executeAndIngest({ ...params, payload });
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

  private async executeAndIngest(
    params: TriggerRunParams | WebhookRunParams,
    fromDlqRetry = false,
  ): Promise<void> {
    const context = this.buildContext(params);
    let records: unknown[];

    try {
      records = await params.trigger.run(context);
    } catch (err) {
      if (fromDlqRetry) {
        // DLQ processor owns retry counting — re-throw so it can increment
        // the attempt counter and schedule a delayed retry instead of
        // creating a new attempt=1 job that bypasses the existing counter.
        throw err;
      }
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

      try {
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
          const sourceCursor = extractRecordCursor(record);
          await store.put('last_cursor', sourceCursor);
        }
      } catch (err) {
        // Per-record failure — push to DLQ so it’s retried, then re-throw
        // so the batch fails visibly and the cursor does not advance past
        // unprocessed records.
        this.logger.error('Record ingest failed — pushing to DLQ', {
          sourceEventId,
          appName: params.appName,
          triggerName: params.triggerName,
          workspaceId: params.workspaceId,
          error: err instanceof Error ? err.message : String(err),
        });
        await this.pushToDlq(params, err);
        throw err;
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
    // rowCount === 0 means a duplicate (ON CONFLICT DO NOTHING) — not an error.
    // Any real DB failure propagates as a thrown exception to the caller, which
    // will route the entire batch to the DLQ via pushToDlq.
    return (result.rowCount ?? 0) > 0;
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
      auth: params.auth, // required for credential reconstruction on retry
      failedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      attempt: 1,
    });
    await this.redis.lpush('dlq:triggers', job);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private buildContext(
    params: TriggerRunParams | WebhookRunParams,
  ): TriggerContext {
    return {
      auth: params.auth,
      propsValue: params.propsValue,
      store: this.buildStore(params),
      // payload is set for webhook triggers; undefined for polling triggers
      payload: 'payload' in params ? params.payload : undefined,
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
      params.appName,
      params.objectType,
      params.triggerName,
    );
  }

  /**
   * Builds a stable, bounded fingerprint for a trigger record.
   *
   * Design decisions:
   *  - Keys are sorted so insertion order doesn't affect the hash.
   *  - Common volatile fields (timestamps, ETags, version counters) are
   *    stripped so repeated polls of the same logical record produce the
   *    same ID even when the API updates those fields.
   *  - The serialized string is capped at FINGERPRINT_MAX_BYTES before
   *    hashing to prevent O(n) hashing of very large payloads.
   *  - Falls back to JSON.stringify for non-object records (arrays, strings).
   *
   * Tradeoff: stripping volatile keys means a record whose ONLY change is
   * e.g. a timestamp bump will hash identically — acceptable for polling
   * deduplication where we track "have we seen this logical record" rather
   * than "has this record changed since last poll".
   */
  private buildSourceEventId(
    workspaceId: string,
    triggerName: string,
    record: unknown,
  ): string {
    const FINGERPRINT_MAX_BYTES = 4096;
    const VOLATILE_KEYS = new Set([
      'SystemModstamp',
      'LastModifiedDate',
      'LastReferencedDate',
      'LastViewedDate',
      '_etag',
      'etag',
      'version',
      '__v',
    ]);

    let payload: string;
    if (
      record !== null &&
      typeof record === 'object' &&
      !Array.isArray(record)
    ) {
      const sorted = Object.keys(record as Record<string, unknown>)
        .filter((k) => !VOLATILE_KEYS.has(k))
        .sort((a, b) => a.localeCompare(b))
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (record as Record<string, unknown>)[k];
          return acc;
        }, {});
      payload = JSON.stringify(sorted);
    } else {
      payload = JSON.stringify(record);
    }

    const bounded =
      payload.length > FINGERPRINT_MAX_BYTES
        ? payload.slice(0, FINGERPRINT_MAX_BYTES)
        : payload;

    return createHash('sha256')
      .update(`${workspaceId}:${triggerName}:${bounded}`)
      .digest('hex');
  }

  /**
   * Acquires a Redis NX lock and returns a unique token identifying this holder.
   * Returns null if the lock is already held by another process.
   */
  private async acquireLock(key: string): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(
      key,
      token,
      'PX',
      this.LOCK_TTL_MS,
      'NX',
    );
    return result === 'OK' ? token : null;
  }

  /**
   * Releases the lock ONLY if the stored value matches the caller's token.
   * Uses a Lua script to guarantee atomicity — prevents a process from
   * accidentally deleting another process's lock after TTL expiry.
   */
  private async releaseLock(key: string, token: string): Promise<void> {
    const lua = [
      "if redis.call('get', KEYS[1]) == ARGV[1] then",
      "  return redis.call('del', KEYS[1])",
      'else',
      '  return 0',
      'end',
    ].join('\n');
    await this.redis.eval(lua, 1, key, token);
  }
}

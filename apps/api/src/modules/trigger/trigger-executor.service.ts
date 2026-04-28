import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Trigger, TriggerContext } from '@nexiom/piece-framework';
import type { DrizzleDb } from '@nexiom/database';
import {
  DATABASE_CONNECTION,
  connectionStorageRegistry,
  buildTenantSchema,
  assertValidSchemaName,
} from '@nexiom/database';
import { sql, eq } from 'drizzle-orm';
import { SchemaPlan } from '@nexiom/dbmanager';
import type { DatabaseManager } from '@nexiom/dbmanager';
import { DB_MANAGER } from '../dbmanager/dbmanager.module.js';
import { StorageResolverService } from '@nexiom/engine';
import type { Redis } from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import { RedisBackedTriggerStore } from './redis-trigger-store.js';

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
  connectionId: string;
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
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
    private readonly storageResolver: StorageResolverService,
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

    // Derive a stable dedup key from the raw body so concurrent deliveries of
    // the same event compete for the same lock (identical to runPoll semantics).
    const bodyHash = createHash('sha256')
      .update(rawBody)
      .digest('hex')
      .slice(0, 16);
    const lockKey = `lock:webhook:${params.workspaceId}:${params.triggerName}:${bodyHash}`;
    const token = await this.acquireLock(lockKey);
    if (!token) {
      this.logger.debug('Skipping webhook — lock held (duplicate delivery)', {
        workspaceId: params.workspaceId,
        triggerName: params.triggerName,
      });
      return;
    }

    try {
      await this.executeAndIngest({ ...params, payload });
    } finally {
      await this.releaseLock(lockKey, token);
    }
  }

  // ─── onEnable / onDisable ────────────────────────────────────────────────

  async runOnEnable(params: TriggerRunParams): Promise<void> {
    const context = this.buildContext(params);
    let wroteRegistryRow = false;
    let registeredPublication = false;
    try {
      // 1. Ensure all pipeline tables are provisioned lazily
      await this.dbManager.applyPlan(
        params.workspaceId,
        SchemaPlan.OUTBOUND_ACTIVE,
      );

      // 2. Register the tenant's outbox tables with Debezium CDC publication.
      // We wrap the ALTER PUBLICATION safe DO block to ignore duplicate additions.
      // This must happen BEFORE onEnable so that publication failures don't leave
      // external subscriptions (e.g., webhooks) active without CDC relay.
      const resolvedSchemaName = await this.storageResolver.resolveSchemaName(
        params.connectionId,
      );
      assertValidSchemaName(resolvedSchemaName);
      await this.db.execute(sql`
        DO $$
        BEGIN
          BEGIN
            ALTER PUBLICATION nexiom_cdc
              ADD TABLE ${sql.raw('"' + resolvedSchemaName + '"')}.inbound_outbox,
                        ${sql.raw('"' + resolvedSchemaName + '"')}.replica_outbox,
                        ${sql.raw('"' + resolvedSchemaName + '"')}.normalized_outbox,
                        ${sql.raw('"' + resolvedSchemaName + '"')}.delivery_outbox;
          EXCEPTION WHEN duplicate_object THEN
            -- Ignore gracefully if the table is already in the publication
          END;
        END $$;
      `);
      registeredPublication = true;

      // 3. Invoke the trigger enablement logic (e.g. subscribe to webhook).
      // The registry row is written AFTER this succeeds so that delivery
      // workers never see OUTBOUND_ACTIVE for a workspace whose onEnable
      // threw (e.g. webhook subscription failed).
      await params.trigger.onEnable?.(context);

      // 4. Persist the provisioned schemaPlan only once onEnable has succeeded.
      await this.db
        .update(connectionStorageRegistry)
        .set({ schemaPlan: SchemaPlan.OUTBOUND_ACTIVE })
        .where(eq(connectionStorageRegistry.dataNamespace, params.workspaceId));
      wroteRegistryRow = true;

      this.logger.log('onEnable completed', {
        appName: params.appName,
        triggerName: params.triggerName,
        workspaceId: params.workspaceId,
      });
    } catch (err) {
      // Revert changes in reverse order of application

      // 1. Only revert the registry row if the write actually happened.
      // If applyPlan or publication or onEnable threw before reaching the UPDATE,
      // the row was never changed and reverting would be a spurious write.
      if (wroteRegistryRow) {
        try {
          await this.db
            .update(connectionStorageRegistry)
            .set({ schemaPlan: SchemaPlan.NAMESPACE_ONLY })
            .where(
              eq(connectionStorageRegistry.dataNamespace, params.workspaceId),
            );
        } catch (revertErr) {
          this.logger.error(
            'Failed to revert schemaPlan after onEnable failure',
            {
              workspaceId: params.workspaceId,
              error:
                revertErr instanceof Error
                  ? revertErr.message
                  : String(revertErr),
            },
          );
        }
      }

      // 2. Attempt to remove the publication registration if it was successful.
      // This prevents CDC events from flowing for a trigger whose onEnable failed.
      if (registeredPublication) {
        try {
          const resolvedSchemaName =
            await this.storageResolver.resolveSchemaName(params.connectionId);
          assertValidSchemaName(resolvedSchemaName);
          await this.db.execute(sql`
            DO $$
            BEGIN
              BEGIN
                ALTER PUBLICATION nexiom_cdc
                  DROP TABLE ${sql.raw('"' + resolvedSchemaName + '"')}.inbound_outbox,
                             ${sql.raw('"' + resolvedSchemaName + '"')}.replica_outbox,
                             ${sql.raw('"' + resolvedSchemaName + '"')}.normalized_outbox,
                             ${sql.raw('"' + resolvedSchemaName + '"')}.delivery_outbox;
              EXCEPTION WHEN undefined_object THEN
                -- Ignore gracefully if the table is not in the publication
              END;
            END $$;
          `);
        } catch (pubRevertErr) {
          this.logger.error(
            'Failed to revert publication registration after onEnable failure',
            {
              workspaceId: params.workspaceId,
              connectionId: params.connectionId,
              error:
                pubRevertErr instanceof Error
                  ? pubRevertErr.message
                  : String(pubRevertErr),
            },
          );
        }
      }

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

    const schemaName = await this.storageResolver.resolveSchemaName(
      params.connectionId,
    );

    let inserted = 0;
    let currentIndex = 0;
    const store = this.buildStore(params);

    for (const record of records) {
      const sourceEventId = this.buildSourceEventId(
        params.workspaceId,
        params.triggerName,
        record,
      );

      try {
        const didInsert = await this.insertGatewayRow(schemaName, {
          connectionId: params.connectionId,
          objectType: params.objectType,
          payload: record,
          extReqId: sourceEventId,
        });

        if (didInsert) {
          inserted++;
          const sourceCursor = extractRecordCursor(record);
          await store.put('last_cursor', sourceCursor);
        }
      } catch (err) {
        await this.handleRecordIngestFailure(
          params,
          fromDlqRetry,
          records,
          currentIndex,
          sourceEventId,
          err,
        );
      }

      currentIndex++;
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

  private async handleRecordIngestFailure(
    params: TriggerRunParams | WebhookRunParams,
    fromDlqRetry: boolean,
    records: unknown[],
    currentIndex: number,
    sourceEventId: string,
    err: unknown,
  ): Promise<void> {
    // Per-record failure — push to DLQ so it’s retried, then re-throw
    // so the batch fails visibly and the cursor does not advance past
    // unprocessed records.
    this.logger.error('Record ingest failed', {
      sourceEventId,
      appName: params.appName,
      triggerName: params.triggerName,
      workspaceId: params.workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });

    // Skip pushing to DLQ if we are already in a DLQ retry context,
    // so the outer DLQ layer increments the retry attempt counter instead
    // of appending a duplicate DLQ job via this nested catch block.
    if (fromDlqRetry) {
      throw err;
    }

    // For webhooks, `params` may have a `payload` containing the full array or payload.
    // We update it to only contain the remaining unprocessed records so
    // the DLQ retry doesn't re-process already committed records.
    const remainingRecords = records.slice(currentIndex);
    let dlqParams: TriggerRunParams | WebhookRunParams = params;
    if ('payload' in params) {
      dlqParams = {
        ...params,
        payload: Array.isArray(params.payload)
          ? remainingRecords
          : params.payload,
      };
    }

    await this.pushToDlq(dlqParams, err);
    throw err;
  }

  // ─── Gateway row insert ──────────────────────────────────────────────────

  private async insertGatewayRow(
    schemaName: string,
    row: {
      connectionId: string;
      objectType: string | undefined;
      payload: unknown;
      extReqId: string;
    },
  ): Promise<boolean> {
    // Validate schema name BEFORE creating any schema-derived handles
    assertValidSchemaName(schemaName);

    let didInsert = false;
    const { inboundGateway, inboundOutbox } = buildTenantSchema(schemaName);

    // Strict transactional domain: guarantees L1 payload AND L1 outbox are written together
    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );

      const result = await tx
        .insert(inboundGateway)
        .values({
          traceId: randomUUID(),
          connectionId: row.connectionId,
          extReqId: row.extReqId,
          objectType: row.objectType ?? null,
          request: row.payload,
        })
        .onConflictDoNothing({ target: inboundGateway.extReqId })
        .returning({ traceId: inboundGateway.traceId });

      if (result.length > 0) {
        await tx
          .insert(inboundOutbox)
          .values({
            traceId: result[0].traceId,
            connectionId: row.connectionId,
          })
          .onConflictDoNothing({
            target: [inboundOutbox.traceId, inboundOutbox.connectionId],
          });
        didInsert = true;
      }
    });

    return didInsert;
  }

  // ─── DLQ ─────────────────────────────────────────────────────────────────

  private async pushToDlq(
    params: TriggerRunParams | WebhookRunParams,
    err: unknown,
  ): Promise<void> {
    const job = JSON.stringify({
      appName: params.appName,
      triggerName: params.triggerName,
      workspaceId: params.workspaceId,
      connectionId: params.connectionId,
      objectType: params.objectType,
      propsValue: params.propsValue,
      auth: params.auth, // required for credential reconstruction on retry
      // Preserve webhook payload for retry (may contain remaining unprocessed records)
      payload: 'payload' in params ? params.payload : undefined,
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
        .sort((a, b) => (a ?? '').localeCompare(b ?? ''))
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

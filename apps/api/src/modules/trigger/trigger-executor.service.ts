import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Trigger, TriggerContext } from '@soopa/piece-framework';
import type { DrizzleDb } from '@soopa/database';
import {
  DATABASE_CONNECTION,
  buildTenantSchema,
  assertValidSchemaName,
  dataSources,
} from '@soopa/database';
import { sql, eq } from 'drizzle-orm';
import { SchemaPlan } from '@soopa/dbmanager';
import type { DatabaseManager } from '@soopa/dbmanager';
import { DB_MANAGER } from '@soopa/dbmanager';
import { StorageResolverService } from '@soopa/pipeline';
import { randomUUID } from 'node:crypto';
import { IDistributedLockService } from './interfaces/distributed-lock.interface.js';
import { KeyValueTriggerStore } from './key-value-trigger-store.js';
import type { IKeyValueStore } from '@soopa/cache';
import { TriggerPayloadTransformer } from './trigger-payload-transformer.js';
import { TriggerRetryPolicyService } from './trigger-retry-policy.service.js';

export interface TriggerRunParams {
  trigger: Trigger;
  appName: string;
  triggerName: string;
  objectType: string | undefined;
  auth: unknown;
  propsValue: Record<string, unknown>;
  tenantId: string;
  workspaceId: string;
  dataSourceId: string;
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
    @Inject(IDistributedLockService)
    private readonly lockService: IDistributedLockService,
    private readonly retryPolicyService: TriggerRetryPolicyService,
    private readonly payloadTransformer: TriggerPayloadTransformer,
    @Inject('KEY_VALUE_STORE') private readonly kvStore: IKeyValueStore, // for KeyValueTriggerStore
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
    const payload = this.payloadTransformer.parseWebhookPayload(rawBody);

    // Derive a stable dedup key from the raw body so concurrent deliveries of
    // the same event compete for the same lock (identical to runPoll semantics).
    const bodyHash = this.payloadTransformer.buildWebhookLockHash(rawBody);
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
      const resolvedSchemaName = await this.storageResolver.resolveSchemaName(
        params.dataSourceId,
      );
      assertValidSchemaName(resolvedSchemaName);

      const ds = await this.db.query.dataSources.findFirst({
        where: eq(dataSources.id, params.dataSourceId),
        columns: { metadata: true },
      });
      const appProfile =
        ds?.metadata &&
        typeof ds.metadata === 'object' &&
        'appProfile' in ds.metadata
          ? (ds.metadata.appProfile as string)
          : 'standard';

      // 1. Ensure all pipeline tables are provisioned lazily
      await this.dbManager.applyPlan(
        params.tenantId,
        resolvedSchemaName,
        SchemaPlan.OUTBOUND_ACTIVE,
        { appName: params.appName, appProfile },
      );
      await this.db.execute(sql`
        DO $$
        BEGIN
          BEGIN
            ALTER PUBLICATION platform_cdc
              ADD TABLE ${sql.raw('"' + resolvedSchemaName + '"')}.inbound_outbox,
                        ${sql.raw('"' + resolvedSchemaName + '"')}.replica_outbox,
                        ${sql.raw('"' + resolvedSchemaName + '"')}.normalized_outbox,
                        ${sql.raw('"' + resolvedSchemaName + '"')}.outbound_outbox;
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
        .update(dataSources)
        .set({ schemaPlan: SchemaPlan.OUTBOUND_ACTIVE })
        .where(eq(dataSources.id, params.dataSourceId));
      wroteRegistryRow = true;

      this.logger.log('onEnable completed', {
        appName: params.appName,
        triggerName: params.triggerName,
        workspaceId: params.workspaceId,
      });
    } catch (err) {
      // Revert changes in reverse order of application

      // 1. Only revert the registry row if the write actually happened.
      if (wroteRegistryRow) {
        try {
          await this.db
            .update(dataSources)
            .set({ schemaPlan: SchemaPlan.NAMESPACE_ONLY })
            .where(eq(dataSources.id, params.dataSourceId));
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
      if (registeredPublication) {
        try {
          const resolvedSchemaName =
            await this.storageResolver.resolveSchemaName(params.dataSourceId);
          assertValidSchemaName(resolvedSchemaName);
          await this.db.execute(sql`
            DO $$
            BEGIN
              BEGIN
                ALTER PUBLICATION platform_cdc
                  DROP TABLE ${sql.raw('"' + resolvedSchemaName + '"')}.inbound_outbox,
                             ${sql.raw('"' + resolvedSchemaName + '"')}.replica_outbox,
                             ${sql.raw('"' + resolvedSchemaName + '"')}.normalized_outbox,
                             ${sql.raw('"' + resolvedSchemaName + '"')}.outbound_outbox;
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
              dataSourceId: params.dataSourceId,
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
      await this.retryPolicyService.pushToDlq(params, err);
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
      params.dataSourceId,
    );

    let inserted = 0;
    let currentIndex = 0;
    const store = this.buildStore(params);

    for (const record of records) {
      const sourceEventId = this.payloadTransformer.buildSourceEventId(
        params.workspaceId,
        params.triggerName,
        record,
      );

      try {
        const didInsert = await this.insertGatewayRow(schemaName, {
          dataSourceId: params.dataSourceId,
          objectType: params.objectType,
          payload: record,
          extReqId: sourceEventId,
        });

        if (didInsert) {
          inserted++;
          const sourceCursor =
            this.payloadTransformer.extractRecordCursor(record);
          if (sourceCursor !== undefined) {
            await store.put('last_cursor', sourceCursor);
          }
        }
      } catch (err) {
        await this.retryPolicyService.handleRecordIngestFailure(
          params,
          fromDlqRetry,
          records,
          currentIndex,
          sourceEventId,
          err,
          this.logger,
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

  // ─── Gateway row insert ──────────────────────────────────────────────────

  private async insertGatewayRow(
    schemaName: string,
    row: {
      dataSourceId: string;
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
          dataSourceId: row.dataSourceId,
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
            dataSourceId: row.dataSourceId,
          })
          .onConflictDoNothing({
            target: [inboundOutbox.traceId, inboundOutbox.dataSourceId],
          });
        didInsert = true;
      }
    });

    return didInsert;
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
    return new KeyValueTriggerStore(
      this.kvStore,
      params.workspaceId,
      params.appName,
      params.objectType,
      params.triggerName,
    );
  }

  /**
   * Acquires a Redis NX lock and returns a unique token identifying this holder.
   * Returns null if the lock is already held by another process.
   */
  private async acquireLock(key: string): Promise<string | null> {
    return this.lockService.acquireLock(key, this.LOCK_TTL_MS);
  }

  /**
   * Releases the lock ONLY if the stored value matches the caller's token.
   */
  private async releaseLock(key: string, token: string): Promise<void> {
    await this.lockService.releaseLock(key, token);
  }
}

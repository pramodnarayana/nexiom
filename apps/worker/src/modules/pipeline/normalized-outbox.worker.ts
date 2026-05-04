import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { eq, sql, and } from "drizzle-orm";
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  buildTenantSchema,
  tenantStorageRegistry,
  appConnections,
} from "@nexiom/database";
import { QueueName } from "@nexiom/queue";
import { QueueService } from "@nexiom/queue";
import { getWorkspaceSchemaName } from "@nexiom/dbmanager";
import type { DatabaseManager } from "@nexiom/dbmanager";
import { DB_MANAGER } from "@nexiom/dbmanager";
import { processInChunks } from "./outbox.utils.js";

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 6;

@Injectable()
export class NormalizedOutboxWorker {
  private readonly logger = new Logger(NormalizedOutboxWorker.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    private readonly queueService: QueueService,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async processOutbox(): Promise<void> {
    try {
      // 1. Query tenantStorageRegistry in the Global DB to get all tenant databases.
      const tenants = await this.globalDb
        .select({ tenantId: tenantStorageRegistry.tenantId })
        .from(tenantStorageRegistry);

      if (tenants.length === 0) {
        return;
      }

      // Process tenants with bounded concurrency to prevent unbounded fan-out
      const TENANT_CONCURRENCY = 5;
      await processInChunks(tenants, TENANT_CONCURRENCY, async (tenant) => {
        try {
          // 2. Use TenantDatabaseManager to connect to the specific physical tenant DB.
          const tenantDb = await this.dbManager.getTenantDb(tenant.tenantId);

          // 3. Query app_connection inside the Global DB to find all ACTIVE connections for this tenant
          // that have normalized_outbox provisioned (OUTBOUND_ACTIVE or GATEWAY_ACTIVE plans).
          const connections = await this.globalDb
            .select({ id: appConnections.id, appName: appConnections.appName })
            .from(appConnections)
            .where(
              and(
                eq(appConnections.status, "ACTIVE"),
                eq(appConnections.tenantId, tenant.tenantId),
                sql`${appConnections.schemaPlan} IN ('OUTBOUND_ACTIVE', 'GATEWAY_ACTIVE')`,
              ),
            );

          if (connections.length === 0) {
            return;
          }

          // 4. Run drainWorkspaceOutbox on each schema derived from the connection.
          for (const connection of connections) {
            const schemaName = getWorkspaceSchemaName(
              connection.id,
              connection.appName,
            );
            try {
              await this.drainWorkspaceOutbox(tenantDb, schemaName);
            } catch (schemaErr) {
              this.logger.error(
                `[${tenant.tenantId}] Failed to drain normalized outbox for schema ${schemaName}: ${schemaErr instanceof Error ? schemaErr.message : String(schemaErr)}`,
              );
            }
          }
        } catch (tenantErr) {
          this.logger.error(
            `Failed to process normalized outbox for tenant ${tenant.tenantId}: ${tenantErr instanceof Error ? tenantErr.message : String(tenantErr)}`,
          );
        }
      });
    } catch (err) {
      this.logger.error(
        `Failed to query global tenant registry for normalized outbox: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async drainWorkspaceOutbox(
    tenantDb: DrizzleDb,
    schemaName: string,
  ): Promise<void> {
    const { normalizedOutbox } = buildTenantSchema(schemaName);

    // Atomically claim rows
    const claimed = await tenantDb.transaction(async (tx) => {
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.identifier(schemaName)}`,
      );

      return tx
        .update(normalizedOutbox)
        .set({
          status: "PROCESSING",
          attempts: sql`${normalizedOutbox.attempts} + 1`,
          nextRetryAt: sql`NOW() + INTERVAL '5 minutes'`,
        })
        .where(
          sql`${normalizedOutbox.id} IN (
            SELECT id FROM ${sql.identifier(schemaName)}.normalized_outbox
            WHERE status = 'PENDING' 
               OR (status = 'RETRY' AND next_retry_at <= NOW())
               OR (status = 'PROCESSING' AND next_retry_at <= NOW())
            ORDER BY next_retry_at ASC
            LIMIT ${BATCH_SIZE}
            FOR UPDATE SKIP LOCKED
          )`,
        )
        .returning();
    });

    if (claimed.length === 0) return;

    this.logger.debug(
      `[${schemaName}] Claimed ${claimed.length} normalized outbox rows`,
    );

    // Process claimed rows
    const results = await processInChunks(
      claimed,
      5, // Concurrency cap array for queue publish ops
      (row) => this.processOutboxRow(tenantDb, schemaName, row),
    );

    results.forEach((result, idx) => {
      if (result.status === "rejected") {
        this.logger.error(
          `[${schemaName}] processOutboxRow critically failed for row id=${claimed[idx].id}: ${
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason)
          }`,
        );
      }
    });
  }

  private async processOutboxRow(
    tenantDb: DrizzleDb,
    schemaName: string,
    row: {
      id: string;
      traceId: string;
      connectionId: string;
      attempts: number;
    },
  ): Promise<void> {
    const { normalizedOutbox } = buildTenantSchema(schemaName);

    let queueSuccess = false;
    try {
      // Send to L4 Queue (NormalizedQueue -> consumed by FanOut)
      // Note: traceId acts as the consumer deduplication key. Duplicate queue
      // messages are harmless because the L4 consumer enforces idempotency
      // via ON CONFLICT DO NOTHING using this traceId/routeId.
      await this.queueService.send(QueueName.NormalizedQueue, {
        traceId: row.traceId,
        connectionId: row.connectionId,
      });
      queueSuccess = true;
    } catch (err) {
      const lastError = err instanceof Error ? err.message : String(err);
      try {
        if (row.attempts >= MAX_ATTEMPTS) {
          await tenantDb
            .update(normalizedOutbox)
            .set({ status: "FAIL", lastError })
            .where(eq(normalizedOutbox.id, row.id));
          this.logger.error(
            `[${schemaName}] NormalizedOutbox delivery permanently failed for traceId=${row.traceId}: ${lastError}`,
          );
        } else {
          const delayMs = Math.pow(2, row.attempts) * 1_000;
          const nextRetryAt = new Date(Date.now() + delayMs);
          await tenantDb
            .update(normalizedOutbox)
            .set({ status: "RETRY", lastError, nextRetryAt })
            .where(eq(normalizedOutbox.id, row.id));
          this.logger.warn(
            `[${schemaName}] NormalizedOutbox delivery delayed for traceId=${row.traceId} (attempt ${row.attempts}): ${lastError}`,
          );
        }
      } catch (dbErr) {
        this.logger.error(
          `[${schemaName}] Failed to persist FAIL/RETRY status for normalized_outbox id=${row.id}: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
        );
      }
      return; // Stop processing this row
    }

    if (queueSuccess) {
      try {
        // Mark success
        await tenantDb
          .update(normalizedOutbox)
          .set({ status: "SUCCESS" })
          .where(eq(normalizedOutbox.id, row.id));

        this.logger.debug(
          `[${schemaName}] Delivered L3->L4 trace=${row.traceId}`,
        );
      } catch (dbErr) {
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        this.logger.error(
          `[${schemaName}] Published to queue but failed to update status to SUCCESS for normalized_outbox id=${row.id}: ${msg}`,
        );
      }
    }
  }
}

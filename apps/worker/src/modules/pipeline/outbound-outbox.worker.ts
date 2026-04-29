import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { eq, sql } from "drizzle-orm";
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
import { DB_MANAGER } from "../dbmanager/dbmanager.module.js";
import { processInChunks } from "./outbox.utils.js";

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 6;

@Injectable()
export class OutboundOutboxWorker {
  private readonly logger = new Logger(OutboundOutboxWorker.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    private readonly queueService: QueueService,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async processOutbox(): Promise<void> {
    try {
      // 1. Query tenantStorageRegistry in the Global DB to get all tenant databases.
      const tenants = await this.globalDb.select().from(tenantStorageRegistry);

      if (tenants.length === 0) {
        return;
      }

      // Process tenants concurrently
      await Promise.allSettled(
        tenants.map(async (tenant) => {
          try {
            // 2. Use TenantDatabaseManager to connect to the specific physical tenant DB.
            const tenantDb = await this.dbManager.getTenantDb(tenant.tenantId);

            // 3. Query app_connection inside each tenant DB to find all active connections.
            const connections = await tenantDb.select().from(appConnections);

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
                  `[${tenant.tenantId}] Failed to drain outbox for schema ${schemaName}: ${schemaErr instanceof Error ? schemaErr.message : String(schemaErr)}`,
                );
              }
            }
          } catch (tenantErr) {
            this.logger.error(
              `Failed to process outbox for tenant ${tenant.tenantId}: ${tenantErr instanceof Error ? tenantErr.message : String(tenantErr)}`,
            );
          }
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to query global tenant registry for outbound outbox: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async drainWorkspaceOutbox(
    tenantDb: DrizzleDb,
    schemaName: string,
  ): Promise<void> {
    const { outboundOutbox } = buildTenantSchema(schemaName);

    // Atomically claim rows
    const claimed = await tenantDb.transaction(async (tx) => {
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.identifier(schemaName)}`,
      );

      return tx
        .update(outboundOutbox)
        .set({
          status: "PROCESSING",
          attempts: sql`${outboundOutbox.attempts} + 1`,
          nextRetryAt: sql`NOW() + INTERVAL '5 minutes'`,
        })
        .where(
          sql`${outboundOutbox.id} IN (
            SELECT id FROM ${sql.identifier(schemaName)}.outbound_outbox
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
      `[${schemaName}] Claimed ${claimed.length} delivery outbox rows`,
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
      payload: unknown;
      attempts: number;
    },
  ): Promise<void> {
    const { outboundOutbox } = buildTenantSchema(schemaName);

    let queueSuccess = false;
    try {
      // Send to L5 Queue (DeliveryQueue -> consumed by DeliveryService)
      await this.queueService.send(QueueName.DeliveryQueue, {
        ...(row.payload as Record<string, unknown>),
        idempotencyKey: row.id, // provide stable key
      });
      queueSuccess = true;
    } catch (err) {
      const lastError = err instanceof Error ? err.message : String(err);
      try {
        if (row.attempts >= MAX_ATTEMPTS) {
          await tenantDb
            .update(outboundOutbox)
            .set({ status: "FAIL", lastError })
            .where(eq(outboundOutbox.id, row.id));
          this.logger.error(
            `[${schemaName}] OutboundOutbox dispatch permanently failed for outbox id=${row.id}: ${lastError}`,
          );
        } else {
          const delayMs = Math.pow(2, row.attempts) * 1_000;
          const nextRetryAt = new Date(Date.now() + delayMs);
          await tenantDb
            .update(outboundOutbox)
            .set({ status: "RETRY", lastError, nextRetryAt })
            .where(eq(outboundOutbox.id, row.id));
          this.logger.warn(
            `[${schemaName}] OutboundOutbox dispatch delayed for outbox id=${row.id} (attempt ${row.attempts}): ${lastError}`,
          );
        }
      } catch (dbErr) {
        this.logger.error(
          `[${schemaName}] Failed to persist FAIL/RETRY status for outbound_outbox id=${row.id}: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
        );
      }
      return; // Stop processing this row
    }

    if (queueSuccess) {
      try {
        // Mark success
        await tenantDb
          .update(outboundOutbox)
          .set({ status: "SUCCESS" })
          .where(eq(outboundOutbox.id, row.id));

        this.logger.debug(
          `[${schemaName}] Delivered L4->L5 outbox row id=${row.id}`,
        );
      } catch (dbErr) {
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        this.logger.error(
          `[${schemaName}] Published to queue but failed to update status to SUCCESS for outbound_outbox id=${row.id}: ${msg}`,
        );
      }
    }
  }
}

import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { notInArray, eq, sql } from "drizzle-orm";
import { SchemaPlan } from "@nexiom/dbmanager";
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  buildTenantSchema,
  connectionStorageRegistry,
} from "@nexiom/database";
import { QueueName } from "@nexiom/queue";
import { QueueService } from "@nexiom/queue";
import { processInChunks } from "./outbox.utils.js";

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 6;

@Injectable()
export class DeliveryOutboxWorker {
  private readonly logger = new Logger(DeliveryOutboxWorker.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly queueService: QueueService,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async processOutbox(): Promise<void> {
    const workspaces = await this.db
      .select({ dataNamespace: connectionStorageRegistry.dataNamespace })
      .from(connectionStorageRegistry)
      .where(
        notInArray(connectionStorageRegistry.schemaPlan, [
          SchemaPlan.NAMESPACE_ONLY,
        ]),
      )
      .groupBy(connectionStorageRegistry.dataNamespace);

    const results = await processInChunks(
      workspaces,
      5, // Concurrency cap for processing workspaces
      (ws) => this.drainWorkspaceOutbox(ws.dataNamespace),
    );

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        this.logger.error(
          `[${workspaces[index].dataNamespace}] drainWorkspaceOutbox failed: ${
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason)
          }`,
        );
      }
    });
  }

  private async drainWorkspaceOutbox(schemaName: string): Promise<void> {
    const { deliveryOutbox } = buildTenantSchema(schemaName);

    // Atomically claim rows
    const claimed = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.identifier(schemaName)}`,
      );

      return tx
        .update(deliveryOutbox)
        .set({
          status: "PROCESSING",
          attempts: sql`${deliveryOutbox.attempts} + 1`,
          nextRetryAt: sql`NOW() + INTERVAL '5 minutes'`,
        })
        .where(
          sql`${deliveryOutbox.id} IN (
            SELECT id FROM ${sql.identifier(schemaName)}.delivery_outbox
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
      (row) => this.processOutboxRow(schemaName, row),
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
    schemaName: string,
    row: {
      id: string;
      payload: unknown;
      attempts: number;
    },
  ): Promise<void> {
    const { deliveryOutbox } = buildTenantSchema(schemaName);

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
          await this.db
            .update(deliveryOutbox)
            .set({ status: "FAIL", lastError })
            .where(eq(deliveryOutbox.id, row.id));
          this.logger.error(
            `[${schemaName}] DeliveryOutbox dispatch permanently failed for outbox id=${row.id}: ${lastError}`,
          );
        } else {
          const delayMs = Math.pow(2, row.attempts) * 1_000;
          const nextRetryAt = new Date(Date.now() + delayMs);
          await this.db
            .update(deliveryOutbox)
            .set({ status: "RETRY", lastError, nextRetryAt })
            .where(eq(deliveryOutbox.id, row.id));
          this.logger.warn(
            `[${schemaName}] DeliveryOutbox dispatch delayed for outbox id=${row.id} (attempt ${row.attempts}): ${lastError}`,
          );
        }
      } catch (dbErr) {
        this.logger.error(
          `[${schemaName}] Failed to persist FAIL/RETRY status for delivery_outbox id=${row.id}: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
        );
      }
      return; // Stop processing this row
    }

    if (queueSuccess) {
      try {
        // Mark success
        await this.db
          .update(deliveryOutbox)
          .set({ status: "SUCCESS" })
          .where(eq(deliveryOutbox.id, row.id));

        this.logger.debug(
          `[${schemaName}] Delivered L4->L5 outbox row id=${row.id}`,
        );
      } catch (dbErr) {
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        this.logger.error(
          `[${schemaName}] Published to queue but failed to update status to SUCCESS for delivery_outbox id=${row.id}: ${msg}`,
        );
      }
    }
  }
}

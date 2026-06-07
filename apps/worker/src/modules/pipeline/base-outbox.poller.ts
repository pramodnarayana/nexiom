import { Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { PgTable, AnyPgColumn } from "drizzle-orm/pg-core";
import type { DrizzleDb } from "@soopa/database";
import type { QueueName, QueueService } from "@soopa/queue";

const MAX_ATTEMPTS = 6;

export interface OutboxRow {
  id: string;
  attempts: number;
  claimToken?: string | null;
  [key: string]: any;
}

export interface OutboxTable extends PgTable {
  id: AnyPgColumn;
  status: AnyPgColumn;
  attempts: AnyPgColumn;
  nextRetryAt: AnyPgColumn;
  errorMessage: AnyPgColumn;
  claimToken?: AnyPgColumn;
}

export abstract class BaseOutboxPoller {
  protected abstract readonly logger: Logger;
  protected abstract readonly queueService: QueueService;

  /**
   * Centralized DLQ / Retry logic for outbox delivery.
   */
  protected async deliverRow(
    db: DrizzleDb,
    schemaName: string,
    table: OutboxTable,
    row: OutboxRow,
    queueName: QueueName,
    payload: unknown,
    markSuccessImmediately = true,
  ): Promise<void> {
    let queueSuccess = false;

    try {
      await this.queueService.send(queueName, payload);
      queueSuccess = true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      // Inbound poller uses pre-incremented attempts during retry logic, whereas others pre-incremented it in claim query.
      // So we use row.attempts as the truth here.
      const attempts = row.attempts;

      const condition = row.claimToken
        ? sql`${table.id} = ${row.id} AND ${table.status} = 'PROCESSING' AND ${table.claimToken} = ${row.claimToken}`
        : sql`${table.id} = ${row.id} AND ${table.status} = 'PROCESSING' AND ${table.claimToken} IS NULL`;

      try {
        if (attempts >= MAX_ATTEMPTS) {
          const updateObj: Record<string, any> = {
            status: "FAIL",
            errorMessage,
          };
          // Some tables use FAILED instead of FAIL (e.g. global_registry_outbox)
          if (table._.name === "global_registry_outbox") {
            updateObj.status = "FAILED";
          }

          await db.update(table).set(updateObj).where(condition);
          this.logger.error(
            `[${schemaName}] Outbox delivery permanently failed for row id=${row.id}: ${errorMessage}`,
          );
        } else {
          const delayMs = Math.pow(2, attempts) * 1_000;
          const nextRetryAt = new Date(Date.now() + delayMs);

          const updateObj: Record<string, any> = {
            status: "RETRY",
            errorMessage,
            nextRetryAt,
          };
          if (table._.name === "global_registry_outbox") {
            updateObj.status = "PENDING"; // Uses PENDING for retries
          }

          await db.update(table).set(updateObj).where(condition);
          this.logger.warn(
            `[${schemaName}] Outbox delivery delayed for row id=${row.id} (attempt ${attempts}): ${errorMessage}`,
          );
        }
      } catch (dbErr) {
        this.logger.error(
          `[${schemaName}] Failed to persist FAIL/RETRY status for outbox id=${row.id}: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
        );
      }
      return;
    }

    if (queueSuccess && markSuccessImmediately) {
      try {
        const condition = row.claimToken
          ? sql`${table.id} = ${row.id} AND ${table.status} = 'PROCESSING' AND ${table.claimToken} = ${row.claimToken}`
          : sql`${table.id} = ${row.id} AND ${table.claimToken} IS NULL`;

        await db
          .update(table)
          .set({ status: "SUCCESS" }) // Some tables have errorMessage: null, we can just ignore it for now or explicitly set it if needed
          .where(condition);

        this.logger.debug(
          `[${schemaName}] Delivered L${queueName} row=${row.id}`,
        );
      } catch (dbErr) {
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        this.logger.error(
          `[${schemaName}] Published to queue but failed to update status to SUCCESS for outbox id=${row.id}: ${msg}`,
        );
      }
    }
  }

  /**
   * Helper to safely execute workspace schema operations without crashing the poller
   */
  protected async executeSafeSchemaOperation(
    tenantId: string,
    schemaName: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    try {
      await operation();
    } catch (schemaErr) {
      this.logger.error(
        `[${tenantId}] Failed to drain outbox for schema ${schemaName}: ${schemaErr instanceof Error ? schemaErr.message : String(schemaErr)}`,
      );
    }
  }
}

import { sql } from "drizzle-orm";
import type { DrizzleDb } from "@soopa/database";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { randomUUID } from "crypto";
import type {
  OutboxRepositoryPort,
  OutboxRow,
} from "../../core/ports/outbound/outbox-repository.port.js";

export interface OutboxTableSchema extends PgTable {
  id: AnyPgColumn;
  status: AnyPgColumn;
  attempts: AnyPgColumn;
  nextRetryAt: AnyPgColumn;
  errorMessage: AnyPgColumn;
  claimToken?: AnyPgColumn;
}

export class DrizzleOutboxRepositoryAdapter implements OutboxRepositoryPort {
  constructor(
    private readonly db: DrizzleDb,
    private readonly table: OutboxTableSchema,
  ) {}

  async claimNextBatch(
    _tenantId: string,
    schemaName: string,
    batchSize: number,
  ): Promise<OutboxRow[]> {
    const claimToken = randomUUID();
    const tableName = this.table._.name;

    // Use raw SQL identifier for schema scoping
    const claimed = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.identifier(schemaName)}`,
      );

      const updateObj: Record<string, any> = {
        status: "PROCESSING",
        attempts: sql`${this.table.attempts} + 1`,
        nextRetryAt: sql`NOW() + INTERVAL '5 minutes'`,
      };

      // Only set claimToken if the table supports it
      if (this.table.claimToken) {
        updateObj.claimToken = claimToken;
      }

      return tx
        .update(this.table)
        .set(updateObj)
        .where(
          sql`(${this.table.id}) IN (
            SELECT id FROM ${sql.identifier(schemaName)}.${sql.identifier(tableName)}
            WHERE status = 'PENDING'
               OR (status = 'RETRY' AND next_retry_at <= NOW())
               OR (status = 'PROCESSING' AND next_retry_at <= NOW())
            ORDER BY next_retry_at ASC
            LIMIT ${batchSize}
            FOR UPDATE SKIP LOCKED
          )`,
        )
        .returning();
    });

    // Manually map the returned rows to OutboxRow format if needed,
    // though drizzle's .returning() output usually matches it exactly
    return claimed.map((row: unknown) => {
      const r = row as Record<string, unknown>;
      // Drizzle returns the table columns
      return {
        ...r,
        claimToken: this.table.claimToken ? r.claimToken : null,
      } as unknown as OutboxRow;
    });
  }

  async markSuccess(
    _tenantId: string,
    schemaName: string,
    rowId: string,
    claimToken?: string | null,
  ): Promise<void> {
    const condition = this.buildCondition(rowId, claimToken);

    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.identifier(schemaName)}`,
      );
      await tx.update(this.table).set({ status: "SUCCESS" }).where(condition);
    });
  }

  async markRetry(
    _tenantId: string,
    schemaName: string,
    rowId: string,
    _attempts: number,
    errorMessage: string,
    nextRetryAt: Date,
    claimToken?: string | null,
  ): Promise<void> {
    const condition = this.buildCondition(rowId, claimToken);

    // Fallback logic for older tables like global_registry_outbox which don't use RETRY status
    const status =
      this.table._.name === "global_registry_outbox" ? "PENDING" : "RETRY";

    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.identifier(schemaName)}`,
      );
      await tx
        .update(this.table)
        .set({
          status,
          errorMessage,
          nextRetryAt,
        })
        .where(condition);
    });
  }

  async markFailed(
    _tenantId: string,
    schemaName: string,
    rowId: string,
    errorMessage: string,
    claimToken?: string | null,
  ): Promise<void> {
    const condition = this.buildCondition(rowId, claimToken);

    // Fallback logic for global_registry_outbox
    const status =
      this.table._.name === "global_registry_outbox" ? "FAILED" : "FAIL";

    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.identifier(schemaName)}`,
      );
      await tx
        .update(this.table)
        .set({
          status,
          errorMessage,
        })
        .where(condition);
    });
  }

  private buildCondition(rowId: string, claimToken?: string | null) {
    if (this.table.claimToken) {
      if (claimToken) {
        return sql`${this.table.id} = ${rowId} AND ${this.table.status} = 'PROCESSING' AND ${this.table.claimToken} = ${claimToken}`;
      } else {
        throw new Error(
          `claimToken is required for tokenized table ${this.table._.name} but was null/undefined`,
        );
      }
    }
    return sql`${this.table.id} = ${rowId} AND ${this.table.status} = 'PROCESSING'`;
  }
}

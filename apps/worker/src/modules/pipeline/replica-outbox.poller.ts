import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { eq, sql } from "drizzle-orm";
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  buildTenantSchema,
  tenantStorageRegistry,
  dataSources,
} from "@nexiom/database";
import { QueueName } from "@nexiom/queue";
import { QueueService } from "@nexiom/queue";
import { getWorkspaceSchemaName } from "@nexiom/dbmanager";
import type { DatabaseManager } from "@nexiom/dbmanager";
import { DB_MANAGER } from "@nexiom/dbmanager";

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 6;

@Injectable()
export class ReplicaOutboxPoller {
  private readonly logger = new Logger(ReplicaOutboxPoller.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    private readonly queueService: QueueService,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async processOutbox(): Promise<void> {
    try {
      const tenants = await this.globalDb.select().from(tenantStorageRegistry);
      if (tenants.length === 0) return;

      await Promise.allSettled(
        tenants.map(async (tenant) => {
          try {
            const tenantDb = await this.dbManager.getTenantDb(tenant.tenantId);
            const connections = await this.globalDb
              .select()
              .from(dataSources)
              .where(eq(dataSources.tenantId, tenant.tenantId));

            for (const connection of connections) {
              const schemaName = getWorkspaceSchemaName(
                connection.id,
                connection.appName,
              );
              try {
                await this.drainWorkspaceOutbox(tenantDb, schemaName);
              } catch (schemaErr) {
                this.logger.error(
                  `[${tenant.tenantId}] Failed to drain replica outbox for schema ${schemaName}: ${schemaErr instanceof Error ? schemaErr.message : String(schemaErr)}`,
                );
              }
            }
          } catch (tenantErr) {
            this.logger.error(
              `Failed to process replica outbox for tenant ${tenant.tenantId}: ${tenantErr instanceof Error ? tenantErr.message : String(tenantErr)}`,
            );
          }
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to query global tenant registry for replica outbox: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async drainWorkspaceOutbox(
    tenantDb: DrizzleDb,
    schemaName: string,
  ): Promise<void> {
    // Guard: check the schema exists before attempting to query it.
    // A ws_* schema may be absent when:
    //   - The connection was just created and not yet activated/provisioned.
    //   - The schema was dropped during a local dev reset.
    // Skipping is the correct behaviour; the next poll cycle will retry.
    const existsResult = await tenantDb.execute<{ schema_exists: boolean }>(
      sql`SELECT EXISTS (
            SELECT 1 FROM information_schema.schemata
            WHERE schema_name = ${schemaName}
          ) AS schema_exists`,
    );
    const schemaExists = existsResult.rows[0]?.schema_exists ?? false;
    if (!schemaExists) {
      this.logger.debug(
        `[${schemaName}] Schema not provisioned yet — skipping outbox drain`,
      );
      return;
    }

    const { replicaOutbox } = buildTenantSchema(schemaName);

    // Atomically claim rows
    const claimed = await tenantDb.transaction(async (tx) => {
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );

      return tx
        .update(replicaOutbox)
        .set({
          status: "PROCESSING",
          attempts: sql`${replicaOutbox.attempts} + 1`,
          nextRetryAt: sql`NOW() + INTERVAL '5 minutes'`,
        })
        .where(
          sql`${replicaOutbox.id} IN (
            SELECT id FROM ${sql.identifier(schemaName)}.replica_outbox
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
      `[${schemaName}] Claimed ${claimed.length} replica outbox rows`,
    );

    // Process claimed rows
    await Promise.allSettled(
      claimed.map((row) => this.processOutboxRow(tenantDb, schemaName, row)),
    );
  }

  private async processOutboxRow(
    tenantDb: DrizzleDb,
    schemaName: string,
    row: {
      id: string;
      traceId: string;
      dataSourceId: string;
      attempts: number;
    },
  ): Promise<void> {
    const { replicaOutbox } = buildTenantSchema(schemaName);

    try {
      // Send to L3 Queue
      await this.queueService.send(QueueName.ReplicaQueue, {
        traceId: row.traceId,
        dataSourceId: row.dataSourceId,
      });

      // Mark success
      await tenantDb
        .update(replicaOutbox)
        .set({ status: "SUCCESS" })
        .where(eq(replicaOutbox.id, row.id));

      this.logger.debug(
        `[${schemaName}] Delivered L2->L3 trace=${row.traceId}`,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (row.attempts >= MAX_ATTEMPTS) {
        await tenantDb
          .update(replicaOutbox)
          .set({ status: "FAIL", errorMessage })
          .where(eq(replicaOutbox.id, row.id));
        this.logger.error(
          `[${schemaName}] ReplicaOutbox delivery permanently failed for traceId=${row.traceId}: ${errorMessage}`,
        );
      } else {
        const delayMs = Math.pow(2, row.attempts) * 1_000;
        const nextRetryAt = new Date(Date.now() + delayMs);

        await tenantDb
          .update(replicaOutbox)
          .set({ status: "RETRY", errorMessage, nextRetryAt })
          .where(eq(replicaOutbox.id, row.id));
        this.logger.warn(
          `[${schemaName}] ReplicaOutbox delivery delayed for traceId=${row.traceId} (attempt ${row.attempts}): ${errorMessage}`,
        );
      }
    }
  }
}

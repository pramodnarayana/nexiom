import { Injectable, Inject, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Cron, CronExpression } from "@nestjs/schedule";
import { sql, and, eq, inArray } from "drizzle-orm";
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  buildTenantSchema,
  tenantStorageRegistry,
  dataSources,
} from "@soopa/database";
import { QueueName } from "@soopa/queue";
import { QueueService } from "@soopa/queue";
import { getWorkspaceSchemaName } from "@soopa/dbmanager";
import type { DatabaseManager } from "@soopa/dbmanager";
import { DB_MANAGER } from "@soopa/dbmanager";
import { BaseOutboxPoller, type OutboxTable } from "./base-outbox.poller.js";

const BATCH_SIZE = 50;
const DEFAULT_TENANT_CONCURRENCY = 5;

@Injectable()
export class InboundOutboxPoller extends BaseOutboxPoller {
  protected readonly logger = new Logger(InboundOutboxPoller.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    protected readonly queueService: QueueService,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {
    super();
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async processOutbox(): Promise<void> {
    try {
      const tenants = await this.globalDb.select().from(tenantStorageRegistry);
      if (tenants.length === 0) return;

      const results: PromiseSettledResult<void>[] = [];
      for (let i = 0; i < tenants.length; i += DEFAULT_TENANT_CONCURRENCY) {
        const chunk = tenants.slice(i, i + DEFAULT_TENANT_CONCURRENCY);
        const chunkResults = await Promise.allSettled(
          chunk.map(async (tenant) => {
            try {
              const tenantDb = await this.dbManager.getTenantDb(
                tenant.tenantId,
              );
              const connections = await this.globalDb
                .select()
                .from(dataSources)
                .where(
                  and(
                    eq(dataSources.tenantId, tenant.tenantId),
                    inArray(dataSources.schemaPlan, ["OUTBOUND_ACTIVE"]),
                  ),
                );

              for (const connection of connections) {
                const schemaName = getWorkspaceSchemaName(
                  connection.id,
                  connection.appName,
                );
                await this.executeSafeSchemaOperation(
                  tenant.tenantId,
                  schemaName,
                  () => this.drainWorkspaceOutbox(tenantDb, schemaName),
                );
              }
            } catch (tenantErr) {
              this.logger.error(
                `Failed to process inbound outbox for tenant ${tenant.tenantId}: ${tenantErr instanceof Error ? tenantErr.message : String(tenantErr)}`,
              );
            }
          }),
        );
        results.push(...chunkResults);
      }
    } catch (err) {
      this.logger.error(
        `Failed to query global tenant registry for inbound outbox: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async drainWorkspaceOutbox(
    tenantDb: DrizzleDb,
    schemaName: string,
  ): Promise<void> {
    const { inboundOutbox } = buildTenantSchema(schemaName);
    const claimToken = randomUUID();

    const claimed = await tenantDb.transaction(async (tx) => {
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.identifier(schemaName)}`,
      );
      return tx
        .update(inboundOutbox)
        .set({
          status: "PROCESSING",
          claimToken,
          nextRetryAt: sql`NOW() + INTERVAL '5 minutes'`,
        })
        .where(
          sql`(${inboundOutbox.id}) IN (
            SELECT id FROM ${sql.identifier(schemaName)}.inbound_outbox
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
      `[${schemaName}] Claimed ${claimed.length} inbound outbox rows`,
    );

    const CONCURRENCY_LIMIT = 10;
    const processWithLimit = async (rows: typeof claimed) => {
      const results: PromiseSettledResult<void>[] = [];
      for (let i = 0; i < rows.length; i += CONCURRENCY_LIMIT) {
        const chunk = rows.slice(i, i + CONCURRENCY_LIMIT);
        const chunkResults = await Promise.allSettled(
          chunk.map((row) =>
            this.deliverRow(
              tenantDb,
              schemaName,
              inboundOutbox as unknown as OutboxTable,
              row,
              QueueName.InboundQueue,
              { traceId: row.traceId, dataSourceId: row.dataSourceId },
            ),
          ),
        );
        results.push(...chunkResults);
      }
      return results;
    };

    const results = await processWithLimit(claimed);

    const rejections = results
      .map((r, idx) => ({ result: r, row: claimed[idx] }))
      .filter(({ result }) => result.status === "rejected");

    if (rejections.length > 0) {
      rejections.forEach(({ result, row }) => {
        this.logger.error(
          `[${schemaName}] Unexpected processOutboxRow failure for traceId=${row.traceId}, id=${row.id}: ${
            result.status === "rejected"
              ? result.reason instanceof Error
                ? result.reason.message
                : String(result.reason)
              : "unknown"
          }`,
        );
      });
    }
  }
}

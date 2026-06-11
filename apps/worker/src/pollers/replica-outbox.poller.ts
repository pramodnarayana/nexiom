import { BaseOutboxPoller, OutboxTable } from "./base-outbox.poller.js";
import {} from "@soopa/pipeline";
import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { eq, sql } from "drizzle-orm";
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

const BATCH_SIZE = 50;

@Injectable()
export class ReplicaOutboxPoller extends BaseOutboxPoller {
  protected readonly logger = new Logger(ReplicaOutboxPoller.name);

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
              await this.executeSafeSchemaOperation(
                tenant.tenantId,
                schemaName,
                () => this.drainWorkspaceOutbox(tenantDb, schemaName),
              );
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

    await Promise.allSettled(
      claimed.map((row) =>
        this.deliverRow(
          tenantDb,
          schemaName,
          replicaOutbox as unknown as OutboxTable,
          row,
          QueueName.ReplicaQueue,
          { traceId: row.traceId, dataSourceId: row.dataSourceId },
        ),
      ),
    );
  }
}

import { BaseOutboxPoller, OutboxTable } from "./base-outbox.poller.js";
import { processInChunks } from "@soopa/pipeline";
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
export class NormalizedOutboxPoller extends BaseOutboxPoller {
  protected readonly logger = new Logger(NormalizedOutboxPoller.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    protected readonly queueService: QueueService,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {
    super();
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async processOutbox(): Promise<void> {
    try {
      const tenants = await this.globalDb
        .select({ tenantId: tenantStorageRegistry.tenantId })
        .from(tenantStorageRegistry)
        .where(eq(tenantStorageRegistry.status, "ACTIVE"));

      if (tenants.length === 0) {
        return;
      }

      const allConnections = await this.globalDb
        .selectDistinct({
          id: dataSources.id,
          appName: dataSources.appName,
          tenantId: dataSources.tenantId,
        })
        .from(dataSources)
        .where(
          sql`${dataSources.schemaPlan} IN ('OUTBOUND_ACTIVE', 'GATEWAY_ACTIVE', 'NORMALIZE_ACTIVE')`,
        );

      if (allConnections.length === 0) {
        return;
      }

      const connectionsByTenant = new Map<
        string,
        Array<{ id: string; appName: string }>
      >();
      for (const conn of allConnections) {
        if (!connectionsByTenant.has(conn.tenantId)) {
          connectionsByTenant.set(conn.tenantId, []);
        }
        connectionsByTenant
          .get(conn.tenantId)!
          .push({ id: conn.id, appName: conn.appName });
      }

      const TENANT_CONCURRENCY = 5;
      await processInChunks(tenants, TENANT_CONCURRENCY, async (tenant) => {
        try {
          const tenantConnections = connectionsByTenant.get(tenant.tenantId);
          if (!tenantConnections || tenantConnections.length === 0) {
            return;
          }

          const tenantDb = await this.dbManager.getTenantDb(tenant.tenantId);

          for (const connection of tenantConnections) {
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

    const results = await processInChunks(claimed, 5, (row) =>
      this.deliverRow(
        tenantDb,
        schemaName,
        normalizedOutbox as unknown as OutboxTable,
        row,
        QueueName.NormalizedQueue,
        { traceId: row.traceId, dataSourceId: row.dataSourceId },
      ),
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
}

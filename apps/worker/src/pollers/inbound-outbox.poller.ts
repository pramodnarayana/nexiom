import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { and, eq, inArray } from "drizzle-orm";
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  buildTenantSchema,
  tenantStorageRegistry,
  dataSources,
} from "@soopa/database";
import { QueueName } from "@soopa/queue";
import { getWorkspaceSchemaName } from "@soopa/dbmanager";
import type { DatabaseManager } from "@soopa/dbmanager";
import { DB_MANAGER } from "@soopa/dbmanager";

import { ProcessOutboxUseCase } from "../core/use-cases/outbox/process-outbox.use-case.js";
import {
  DrizzleOutboxRepositoryAdapter,
  type OutboxTableSchema,
} from "../adapters/outbound/drizzle-outbox.adapter.js";
import { NestQueuePublisherAdapter } from "../adapters/outbound/nest-queue.adapter.js";

const BATCH_SIZE = 50;
const DEFAULT_TENANT_CONCURRENCY = 5;

@Injectable()
export class InboundOutboxPoller {
  private readonly logger = new Logger(InboundOutboxPoller.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
    private readonly queuePublisherAdapter: NestQueuePublisherAdapter,
  ) {}

  @Cron(process.env.OUTBOX_POLLER_CRON || CronExpression.EVERY_HOUR)
  async processOutbox(): Promise<void> {
    try {
      const tenants = await this.globalDb
        .select()
        .from(tenantStorageRegistry)
        .where(eq(tenantStorageRegistry.status, "ACTIVE"));
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
              const connections = await tenantDb
                .select()
                .from(dataSources)
                .where(
                  and(
                    eq(dataSources.tenantId, tenant.tenantId),
                    inArray(dataSources.schemaPlan, ["STANDARD_ACTIVE"]),
                  ),
                );

              for (const connection of connections) {
                if (
                  !connection.organizationId ||
                  connection.organizationId.trim() === ""
                ) {
                  this.logger.warn(
                    `Skipping connection ${connection.id} due to missing or blank organizationId`,
                  );
                  continue;
                }
                const schemaName = getWorkspaceSchemaName(
                  connection.tenantId,
                  connection.appName,
                  connection.organizationId,
                );
                await this.executeSafeSchemaOperation(
                  tenant.tenantId,
                  schemaName,
                  () =>
                    this.drainWorkspaceOutbox(
                      tenantDb,
                      tenant.tenantId,
                      schemaName,
                    ),
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
    tenantId: string,
    schemaName: string,
  ): Promise<void> {
    const { inboundOutbox } = buildTenantSchema(schemaName);

    const repositoryAdapter = new DrizzleOutboxRepositoryAdapter(
      tenantDb,
      inboundOutbox as unknown as OutboxTableSchema,
    );

    const useCase = new ProcessOutboxUseCase(
      repositoryAdapter,
      this.queuePublisherAdapter,
      {
        batchSize: BATCH_SIZE,
        maxAttempts: 6,
        queueName: QueueName.InboundQueue,
        payloadMapper: (row) => ({
          traceId: row.traceId,
          dataSourceId: row.dataSourceId,
        }),
      },
    );

    await useCase.execute(tenantId, schemaName);
  }

  private async executeSafeSchemaOperation(
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

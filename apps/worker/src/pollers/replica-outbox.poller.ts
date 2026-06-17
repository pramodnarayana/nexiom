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
import { getWorkspaceSchemaName } from "@soopa/dbmanager";
import type { DatabaseManager } from "@soopa/dbmanager";
import { DB_MANAGER } from "@soopa/dbmanager";

import { ProcessOutboxUseCase } from "../core/use-cases/outbox/process-outbox.use-case.js";
import {
  DrizzleOutboxRepositoryAdapter,
  type OutboxTableSchema,
} from "../adapters/outbound/drizzle-outbox.repository.js";
import { NestQueuePublisherAdapter } from "../adapters/outbound/nest-queue.publisher.js";

const BATCH_SIZE = 50;

@Injectable()
export class ReplicaOutboxPoller {
  private readonly logger = new Logger(ReplicaOutboxPoller.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
    private readonly queuePublisherAdapter: NestQueuePublisherAdapter,
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
                connection.tenantId,
                connection.appName,
                connection.vendorTenantId as string,
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
    tenantId: string,
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

    const repositoryAdapter = new DrizzleOutboxRepositoryAdapter(
      tenantDb,
      replicaOutbox as unknown as OutboxTableSchema,
    );

    const useCase = new ProcessOutboxUseCase(
      repositoryAdapter,
      this.queuePublisherAdapter,
      {
        batchSize: BATCH_SIZE,
        maxAttempts: 6,
        queueName: QueueName.ReplicaQueue,
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

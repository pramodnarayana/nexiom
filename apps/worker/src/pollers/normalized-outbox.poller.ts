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
export class NormalizedOutboxPoller {
  private readonly logger = new Logger(NormalizedOutboxPoller.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
    private readonly queuePublisherAdapter: NestQueuePublisherAdapter,
  ) {}

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
          vendorTenantId: dataSources.vendorTenantId,
        })
        .from(dataSources)
        .where(
          sql`${dataSources.schemaPlan} IN ('STANDARD_ACTIVE', 'CANONICAL_ACTIVE')`,
        );

      if (allConnections.length === 0) {
        return;
      }

      const connectionsByTenant = new Map<
        string,
        Array<{ id: string; appName: string; vendorTenantId: string | null }>
      >();
      for (const conn of allConnections) {
        if (!connectionsByTenant.has(conn.tenantId)) {
          connectionsByTenant.set(conn.tenantId, []);
        }
        connectionsByTenant.get(conn.tenantId)!.push({
          id: conn.id,
          appName: conn.appName,
          vendorTenantId: conn.vendorTenantId,
        });
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
            if (!connection.vendorTenantId || connection.vendorTenantId.trim() === '') {
              this.logger.warn(
                `Skipping connection ${connection.id} due to missing or blank vendorTenantId`,
              );
              continue;
            }
            const schemaName = getWorkspaceSchemaName(
              tenant.tenantId,
              connection.appName,
              connection.vendorTenantId,
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
    tenantId: string,
    schemaName: string,
  ): Promise<void> {
    const { normalizedOutbox } = buildTenantSchema(schemaName);

    const repositoryAdapter = new DrizzleOutboxRepositoryAdapter(
      tenantDb,
      normalizedOutbox as unknown as OutboxTableSchema,
    );

    const useCase = new ProcessOutboxUseCase(
      repositoryAdapter,
      this.queuePublisherAdapter,
      {
        batchSize: BATCH_SIZE,
        maxAttempts: 6,
        queueName: QueueName.NormalizedQueue,
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

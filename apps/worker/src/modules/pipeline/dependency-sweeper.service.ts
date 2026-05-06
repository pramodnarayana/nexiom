import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { sql, and, eq } from "drizzle-orm";
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  buildTenantSchema,
  tenantStorageRegistry,
  appConnections,
} from "@nexiom/database";
import { QueueName, QueueService } from "@nexiom/queue";
import { getWorkspaceSchemaName } from "@nexiom/dbmanager";
import type { DatabaseManager } from "@nexiom/dbmanager";
import { DB_MANAGER } from "@nexiom/dbmanager";
import { processInChunks } from "./outbox.utils.js";

@Injectable()
export class DependencySweeperService {
  private readonly logger = new Logger(DependencySweeperService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    private readonly queueService: QueueService,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { waitForCompletion: true })
  async sweepDeferredDependencies(): Promise<void> {
    try {
      this.logger.debug(
        "DependencySweeperService: Starting sweep of DEFERRED_DEPENDENCY records",
      );

      const tenants = await this.globalDb
        .select({ tenantId: tenantStorageRegistry.tenantId })
        .from(tenantStorageRegistry);

      if (tenants.length === 0) return;

      const TENANT_CONCURRENCY = 5;
      await processInChunks(tenants, TENANT_CONCURRENCY, async (tenant) => {
        try {
          const tenantDb = await this.dbManager.getTenantDb(tenant.tenantId);
          const connections = await this.globalDb
            .select({ id: appConnections.id, appName: appConnections.appName })
            .from(appConnections)
            .where(
              and(
                eq(appConnections.status, "ACTIVE"),
                eq(appConnections.tenantId, tenant.tenantId),
                sql`${appConnections.schemaPlan} IN ('OUTBOUND_ACTIVE', 'GATEWAY_ACTIVE')`,
              ),
            );

          for (const conn of connections) {
            let schemaName: string | undefined;
            try {
              schemaName = getWorkspaceSchemaName(conn.id, conn.appName);
              const { outboundGateway, replicaEntity } =
                buildTenantSchema(schemaName);

              const staleRecords = await tenantDb
                .select({ traceId: outboundGateway.traceId })
                .from(outboundGateway)
                .where(
                  and(
                    eq(outboundGateway.status, "DEFERRED_DEPENDENCY"),
                    sql`${outboundGateway.updatedAt} < NOW() - INTERVAL '5 minutes'`,
                  ),
                );

              if (staleRecords.length > 0) {
                this.logger.log(
                  `DependencySweeperService: Found ${staleRecords.length} stale DEFERRED_DEPENDENCY records in schema ${schemaName}`,
                );

                // Deduplicate by traceId to avoid enqueueing the same trace multiple times
                const uniqueTraceIds = new Set(
                  staleRecords.map((record) => record.traceId),
                );

                for (const traceId of uniqueTraceIds) {
                  const replicaRows = await tenantDb
                    .select({ connectionId: replicaEntity.connectionId })
                    .from(replicaEntity)
                    .where(sql`${replicaEntity.traceId} = ${traceId}`)
                    .limit(1);

                  if (replicaRows[0]) {
                    await this.queueService.send(QueueName.NormalizedQueue, {
                      traceId: traceId,
                      connectionId: replicaRows[0].connectionId,
                    });

                    await tenantDb
                      .update(outboundGateway)
                      .set({ status: "PENDING", updatedAt: sql`NOW()` })
                      .where(
                        and(
                          eq(outboundGateway.traceId, traceId),
                          eq(outboundGateway.status, "DEFERRED_DEPENDENCY"),
                        ),
                      );
                  } else {
                    this.logger.warn(
                      `DependencySweeperService: No replica rows found for traceId ${traceId} in schema ${schemaName}. Orphaned DEFERRED_DEPENDENCY may reprocess forever. TODO: Add retry counter and transition to FAILED_DEPENDENCY after threshold.`,
                    );
                  }
                }
              }
            } catch (connErr) {
              this.logger.error(
                `DependencySweeperService: Failed to process connection ${conn.id} (schema: ${schemaName ?? "unknown"})`,
                connErr instanceof Error ? connErr.stack : String(connErr),
              );
            }
          }
        } catch (tenantErr) {
          this.logger.error(
            `DependencySweeperService: Failed to process tenant ${tenant.tenantId}`,
            tenantErr instanceof Error ? tenantErr.stack : String(tenantErr),
          );
        }
      });

      this.logger.debug("DependencySweeperService: Sweep completed");
    } catch (err) {
      this.logger.error(
        "DependencySweeperService: Critical failure",
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}

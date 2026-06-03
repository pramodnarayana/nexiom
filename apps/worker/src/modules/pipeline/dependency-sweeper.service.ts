import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { sql, and, eq, inArray } from "drizzle-orm";
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  buildTenantSchema,
  tenantStorageRegistry,
  dataSources,
  integrationStitches,
} from "@soopa/database";
import { QueueName, QueueService } from "@soopa/queue";
import { getWorkspaceSchemaName } from "@soopa/dbmanager";
import type { DatabaseManager } from "@soopa/dbmanager";
import { DB_MANAGER } from "@soopa/dbmanager";
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
        .from(tenantStorageRegistry)
        .where(eq(tenantStorageRegistry.status, "ACTIVE"));

      // Scope to connections that are SOURCE in an ACTIVE stitch only.
      // The sweeper re-queues DEFERRED_DEPENDENCY records — if no active stitch
      // exists for a connection, FanOut would drop the re-queued event anyway.
      const allConnections = await this.globalDb
        .selectDistinct({
          id: dataSources.id,
          appName: dataSources.appName,
          tenantId: dataSources.tenantId,
          schemaName: dataSources.schemaName,
        })
        .from(dataSources)
        .innerJoin(
          integrationStitches,
          eq(integrationStitches.destDataSourceId, dataSources.id),
        )
        .where(
          and(
            eq(integrationStitches.status, "ACTIVE"),
            sql`${dataSources.schemaPlan} IN ('OUTBOUND_ACTIVE', 'GATEWAY_ACTIVE', 'NORMALIZE_ACTIVE')`,
          ),
        );

      if (allConnections.length === 0) {
        this.logger.debug(
          "DependencySweeperService: No connections with active stitches found, skipping sweep",
        );
        return;
      }

      // Group by tenantId for O(1) lookup inside the per-tenant loop
      const connectionsByTenant = new Map<
        string,
        Array<{ id: string; appName: string; schemaName: string | null }>
      >();
      for (const conn of allConnections) {
        if (!connectionsByTenant.has(conn.tenantId)) {
          connectionsByTenant.set(conn.tenantId, []);
        }
        connectionsByTenant.get(conn.tenantId)!.push({
          id: conn.id,
          appName: conn.appName,
          schemaName: conn.schemaName,
        });
      }

      const TENANT_CONCURRENCY = 5;
      await processInChunks(tenants, TENANT_CONCURRENCY, async (tenant) => {
        try {
          const connections = connectionsByTenant.get(tenant.tenantId);
          if (!connections || connections.length === 0) return;

          const tenantDb = await this.dbManager.getTenantDb(tenant.tenantId);

          // Global deduplication set to prevent re-enqueueing same trace across connections
          const processedTraceIds = new Set<string>();

          for (const conn of connections) {
            let schemaName: string | undefined;
            try {
              // Use persisted schema name if available, otherwise compute
              schemaName =
                conn.schemaName && conn.schemaName.trim() !== ""
                  ? conn.schemaName
                  : getWorkspaceSchemaName(conn.id, conn.appName);
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
                const uniqueTraceIds = Array.from(
                  new Set(staleRecords.map((record) => record.traceId)),
                ).filter((traceId) => !processedTraceIds.has(traceId));

                if (uniqueTraceIds.length === 0) {
                  this.logger.debug(
                    `DependencySweeperService: All traces in schema ${schemaName} already processed by previous connection, skipping`,
                  );
                  continue;
                }

                // Batch-fetch all replica rows in one query to avoid N+1 problem
                const replicaRows = await tenantDb
                  .select({
                    traceId: replicaEntity.traceId,
                    dataSourceId: replicaEntity.dataSourceId,
                  })
                  .from(replicaEntity)
                  .where(inArray(replicaEntity.traceId, uniqueTraceIds));

                // Build a map from traceId -> replica row
                const replicaMap = new Map<string, { dataSourceId: string }>();
                for (const row of replicaRows) {
                  if (!replicaMap.has(row.traceId)) {
                    replicaMap.set(row.traceId, {
                      dataSourceId: row.dataSourceId,
                    });
                  }
                }

                // Process each trace with per-trace error handling
                for (const traceId of uniqueTraceIds) {
                  try {
                    const replicaRow = replicaMap.get(traceId);

                    if (replicaRow) {
                      // First perform the DB claim/update and ensure it affected rows
                      const updateResult = await tenantDb
                        .update(outboundGateway)
                        .set({ status: "PENDING", updatedAt: sql`NOW()` })
                        .where(
                          and(
                            eq(outboundGateway.traceId, traceId),
                            eq(outboundGateway.status, "DEFERRED_DEPENDENCY"),
                          ),
                        )
                        .returning({ id: outboundGateway.id });

                      // Only send to queue if the update affected rows
                      if (updateResult.length > 0) {
                        await this.queueService.send(
                          QueueName.NormalizedQueue,
                          {
                            traceId: traceId,
                            dataSourceId: replicaRow.dataSourceId,
                          },
                        );

                        // Mark as processed globally to prevent re-enqueueing in subsequent connections
                        processedTraceIds.add(traceId);
                      }
                    } else {
                      this.logger.warn(
                        `DependencySweeperService: No replica rows found for traceId ${traceId} in schema ${schemaName}. Orphaned DEFERRED_DEPENDENCY may reprocess forever. TODO: Add retry counter and transition to FAILED_DEPENDENCY after threshold.`,
                      );
                    }
                  } catch (traceErr) {
                    this.logger.error(
                      `DependencySweeperService: Failed to process traceId ${traceId} in schema ${schemaName}`,
                      traceErr instanceof Error
                        ? traceErr.stack
                        : String(traceErr),
                    );
                    // Continue to next traceId without re-throwing
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

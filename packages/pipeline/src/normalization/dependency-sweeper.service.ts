import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { QueueName, QueueService } from "@soopa/queue";
import { getWorkspaceSchemaName } from "@soopa/dbmanager";
import { processInChunks } from "../shared/outbox.utils.js";
import { DEPENDENCY_SWEEPER_REPOSITORY_PORT, DependencySweeperRepositoryPort } from "../shared/ports/dependency-sweeper.repository.port.js";


@Injectable()
export class DependencySweeperService {
  private readonly logger = new Logger(DependencySweeperService.name);

  constructor(
    private readonly queueService: QueueService,
    @Inject(DEPENDENCY_SWEEPER_REPOSITORY_PORT) private readonly sweeperRepo: DependencySweeperRepositoryPort,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { waitForCompletion: true })
  async sweepDeferredDependencies(): Promise<void> {
    try {
      this.logger.debug(
        "DependencySweeperService: Starting sweep of DEFERRED_DEPENDENCY records",
      );

      const tenants = await this.sweeperRepo.getActiveTenants();

      // Scope to connections that are SOURCE in an ACTIVE stitch only.
      // The sweeper re-queues DEFERRED_DEPENDENCY records — if no active stitch
      // exists for a connection, FanOut would drop the re-queued event anyway.
      const allConnections = await this.sweeperRepo.getConnectionsWithActiveStitches();

      if (allConnections.length === 0) {
        this.logger.debug(
          "DependencySweeperService: No connections with active stitches found, skipping sweep",
        );
        return;
      }

      // Group by tenantId for O(1) lookup inside the per-tenant loop
      const connectionsByTenant = new Map<
        string,
        Array<{ id: string; appName: string; schemaName: string | null; vendorTenantId: string | null }>
      >();
      for (const conn of allConnections) {
        if (!connectionsByTenant.has(conn.tenantId)) {
          connectionsByTenant.set(conn.tenantId, []);
        }
        connectionsByTenant.get(conn.tenantId)!.push({
          id: conn.id,
          appName: conn.appName,
          schemaName: conn.schemaName,
          vendorTenantId: conn.vendorTenantId,
        });
      }

      const TENANT_CONCURRENCY = 5;
      await processInChunks(tenants, TENANT_CONCURRENCY, async (tenant) => {
        try {
          const connections = connectionsByTenant.get(tenant.tenantId);
          if (!connections || connections.length === 0) return;

          // Global deduplication set to prevent re-enqueueing same trace across connections
          const processedTraceIds = new Set<string>();

          for (const conn of connections) {
            let schemaName: string | undefined;
            try {
              // Use persisted schema name if available, otherwise compute
              schemaName =
                conn.schemaName && conn.schemaName.trim() !== ""
                  ? conn.schemaName
                  : getWorkspaceSchemaName(tenant.tenantId, conn.appName, conn.vendorTenantId as string);

              const staleRecords = await this.sweeperRepo.getDeferredTraces(tenant.tenantId, schemaName, 5);

              if (staleRecords.length > 0) {
                this.logger.log(
                  `DependencySweeperService: Found ${staleRecords.length} stale DEFERRED_DEPENDENCY records in schema ${schemaName}`,
                );

                // Deduplicate by traceId + routeId to avoid enqueueing the same trace/route multiple times
                const uniqueTraceRoutes = Array.from(
                  new Set(staleRecords.map((record) => `${record.traceId}|${record.routeId}`)),
                ).filter((traceRoute) => !processedTraceIds.has(traceRoute));

                if (uniqueTraceRoutes.length === 0) {
                  this.logger.debug(
                    `DependencySweeperService: All traces in schema ${schemaName} already processed by previous connection, skipping`,
                  );
                  continue;
                }

                const traceIdsForReplica = Array.from(new Set(staleRecords.map((record) => record.traceId)));
                // Batch-fetch all replica rows in one query to avoid N+1 problem
                const replicaRows = await this.sweeperRepo.getReplicaDataSources(tenant.tenantId, schemaName, traceIdsForReplica);

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
                for (const traceRoute of uniqueTraceRoutes) {
                  const [traceId, routeId] = traceRoute.split('|');
                  try {
                    const replicaRow = replicaMap.get(traceId);

                    if (replicaRow) {
                      // First perform the DB claim/update and ensure it affected rows
                      const claimed = await this.sweeperRepo.claimDeferredTrace(tenant.tenantId, schemaName, traceId, routeId);

                      // Only send to queue if the update affected rows
                      if (claimed) {
                        try {
                          await this.queueService.send(
                            QueueName.NormalizedQueue,
                            {
                              traceId: traceId,
                              dataSourceId: replicaRow.dataSourceId,
                            },
                          );

                          // Mark as processed globally to prevent re-enqueueing in subsequent connections
                          processedTraceIds.add(traceRoute);
                        } catch (sendErr) {
                          this.logger.error(
                            `DependencySweeperService: Failed to enqueue traceId ${traceId} (routeId ${routeId}) after claiming. Reverting claim.`,
                            sendErr instanceof Error ? sendErr.stack : String(sendErr)
                          );
                          if (this.sweeperRepo.unclaimDeferredTrace) {
                            await this.sweeperRepo.unclaimDeferredTrace(tenant.tenantId, schemaName, traceId, routeId);
                          }
                          throw sendErr; // rethrow to be caught by the per-trace error handler
                        }
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

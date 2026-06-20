import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { QueueService, QueueName } from "@soopa/queue";
import { StorageResolverService } from "../storage-resolver/storage-resolver.service.js";
import { PipelineHookBrokerService } from "../plugin-hooks/pipeline-hook-broker.service.js";
import { PieceRegistryService } from "@soopa/piece-registry";
import { assertValidSchemaName } from "@soopa/database";
import { NORMALIZATION_REPOSITORY_PORT, type NormalizationRepositoryPort } from "../shared/ports/normalization.repository.port.js";
import { CONNECTION_REPOSITORY_PORT, type ConnectionRepositoryPort } from "../shared/ports/connection.repository.port.js";
import { TRANSACTION_MANAGER_PORT, type TransactionManagerPort, type TxContext } from "../shared/ports/transaction-manager.port.js";
import { SYNC_LOG_REPOSITORY_PORT, type SyncLogRepositoryPort } from "../shared/ports/sync-log.repository.port.js";
import {
  sanitizeError,
  isValidPipelineMessage,
  sanitizeErrorObject,
} from "../utils.js";

@Injectable()
export class NormalizationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NormalizationService.name);

  constructor(
    private readonly queueService: QueueService,
    @Inject(NORMALIZATION_REPOSITORY_PORT) private readonly normalizationRepository: NormalizationRepositoryPort,
    @Inject(CONNECTION_REPOSITORY_PORT) private readonly connectionRepository: ConnectionRepositoryPort,
    @Inject(TRANSACTION_MANAGER_PORT) private readonly transactionManager: TransactionManagerPort,
    @Inject(SYNC_LOG_REPOSITORY_PORT) private readonly syncLogRepository: SyncLogRepositoryPort,
    private readonly storageResolver: StorageResolverService,
    private readonly pieceRegistry: PieceRegistryService,
    private readonly hookBroker: PipelineHookBrokerService,
  ) {}

  onModuleInit() {
    this.queueService.consume(QueueName.ReplicaQueue, async (msg) => {
      await this.processMessage(msg);
    });
  }

  onModuleDestroy() {}

  private async processMessage(rawMsg: unknown): Promise<void> {
    const msg = rawMsg as Record<string, unknown>;

    // ── Poison-pill guard ─────────────────────────────────────────────────────
    // If the message is missing required fields, ACK it (return without throwing)
    // to prevent the SQS message from being redelivered indefinitely.
    if (!isValidPipelineMessage(msg, ["traceId", "dataSourceId"])) {
      this.logger.warn(
        {
          event: "l3.invalid_message",
          layer: "L3",
          msg: JSON.stringify(msg).slice(0, 200),
        },
        "L3: dropping invalid message — missing traceId or dataSourceId",
      );
      return;
    }

    const traceId = msg.traceId as string;
    const dataSourceId = msg.dataSourceId as string;
    const start = Date.now();

    this.logger.debug(
      { event: "l3.started", traceId, dataSourceId, layer: "L3" },
      "L3 normalization started",
    );

    try {
      const passedSchemaName = msg.schemaName as string | undefined;
      let schemaName: string;
      let tenantId: string;

      if (passedSchemaName) {
        // Validate syntax
        assertValidSchemaName(passedSchemaName);

        // Verify ownership: passedSchemaName must belong to this dataSourceId
        const profile =
          await this.storageResolver.resolveStorageProfile(dataSourceId);
        const expectedSchemaName = profile.schemaName;

        if (passedSchemaName !== expectedSchemaName) {
          throw new Error(
            `Schema ownership mismatch: passedSchemaName="${passedSchemaName}" does not belong to dataSourceId="${dataSourceId}" (expected="${expectedSchemaName}")`,
          );
        }

        schemaName = passedSchemaName;
        tenantId = profile.tenantId;
      } else {
        const profile =
          await this.storageResolver.resolveStorageProfile(dataSourceId);
        schemaName = profile.schemaName;
        tenantId = profile.tenantId;
      }

      // ── Resolve piece for this connection ─────────────────────────────────
      const connMeta = await this.connectionRepository.getTenantConnectionMeta(dataSourceId, tenantId);

      if (!connMeta) {
        throw new Error(`Connection ${dataSourceId} not found`);
      }
      const connectionAppName = connMeta.appName;
      const metadata = { appProfile: connMeta.appProfile };

      // Runtime validation of appProfile
      const trimmedAppProfile =
        typeof metadata?.appProfile === "string"
          ? metadata.appProfile.trim()
          : "";
      const appProfile =
        trimmedAppProfile !== "" ? trimmedAppProfile : "standard";

      const piece = this.pieceRegistry.getPiece(connectionAppName);
      if (!piece) {
        throw new Error(
          `Piece "${connectionAppName}" not registered in PieceRegistry`,
        );
      }

      const replicaOrSuperseded = await this.transactionManager.runInTenantTransaction(tenantId, schemaName, async (tx) => {
        // ── Primary lookup: exact traceId match ──────────────────────────────
        const replica = await this.normalizationRepository.findReplicaByTraceId(schemaName, traceId, tx);

        if (replica)
          return { kind: "found" as const, replica };

        // ── Superseded check ─────────────────────────────────────────────────
        const inboundRequest = await this.normalizationRepository.fetchInboundRequest(schemaName, traceId, tx);

        if (!inboundRequest) {
          throw new Error(`InboundGateway row missing for traceId ${traceId}`);
        }

        const extracted = await this.hookBroker.extractReplica(
          connectionAppName,
          appProfile,
          inboundRequest,
        );

        if (!extracted) {
          throw new Error(
            `Failed to extract replica from inbound gateway request for traceId ${traceId}`,
          );
        }

        const { entityId } = extracted;

        const isSuperseded = await this.normalizationRepository.checkIfSuperseded(schemaName, dataSourceId, entityId, traceId, tx);

        if (isSuperseded) {
          // A newer trace owns the entity — this message is stale.
          return { kind: "superseded" as const };
        }

        // Neither exact match nor superseded — L2 transaction likely rolled back.
        throw new Error(
          `Replica record for traceId ${traceId} not found and no superseding record exists. ` +
            `L2 may not have committed. The message will be retried.`,
        );
      });

      // Superseded messages are silently ACK'd — no work to do.
      if (replicaOrSuperseded.kind === "superseded") {
        this.logger.log(
          {
            event: "l3.superseded",
            traceId,
            dataSourceId,
            layer: "L3",
          },
          "L3: replica traceId superseded by newer trace — ACK without processing",
        );
        return;
      }

      const replica = replicaOrSuperseded.replica;

      let canonicalType = "RAW";
      let canonicalData = replica.data;

      // ── Normalize via HookBroker or Piece ────────────────────────────────

      const normalizedFromShard = await this.hookBroker
        .normalize(connectionAppName, appProfile, {
          entityType: replica.entityType,
          data: replica.data as Record<string, unknown>,
        });

      if (normalizedFromShard) {
        canonicalType = normalizedFromShard.canonicalType;
        canonicalData = normalizedFromShard.data;
      } else if (piece.normalize) {
        const normalized = await piece.normalize(
          replica.entityType,
          replica.data as Record<string, unknown>,
        );
        if (normalized) {
          canonicalType = normalized.canonicalType;
          canonicalData = normalized.data;
        }
      }

      let parentTraceIdsForQueue: string[] = [];

      await this.transactionManager.runInTenantTransaction(tenantId, schemaName, async (tx) => {
        // ── Idempotent upsert of normalizedEntity ────────────────────────────
        let safeData: Record<string, unknown>;
        try {
          safeData = JSON.parse(
            JSON.stringify(
              canonicalData != null && typeof canonicalData === "object"
                ? canonicalData
                : {},
            ),
          ) as Record<string, unknown>;
        } catch (serializationErr) {
          throw new Error(
            `Normalization failed for traceId ${traceId}: canonicalData is not JSON-serializable. ` +
              `Error: ${serializationErr instanceof Error ? serializationErr.message : String(serializationErr)}`,
            { cause: serializationErr },
          );
        }

        const normalizedEntityId = await this.normalizationRepository.upsertNormalizedEntity(schemaName, traceId, replica.id, canonicalType, safeData, tx);

        if (normalizedEntityId) {
          // ── Step 3.5: Application canonical write hook ─────────────────────
          let parentTraceIds: string[] = [];
          try {
            await this.transactionManager.runNestedTransaction(tx, async (sp) => {
              await this.hookBroker.writeNormalized(
                connectionAppName,
                appProfile,
                sp,
                sp,
                schemaName,
                replica.id,
                replica.entityId,
                traceId,
                canonicalType,
                safeData,
              );

              // ── Step 3.6: Reverse Lookup (Dependency Resolution) ──────────────
              parentTraceIds = await this.hookBroker.reverseLookup(
                connectionAppName,
                appProfile,
                sp,
                schemaName,
                canonicalType,
                replica.entityId,
              );
            });

            for (const pTraceId of parentTraceIds) {
              parentTraceIdsForQueue.push(pTraceId);
            }
          } catch (hookErr) {
            // Log but do not fail the pipeline — the generic normalized_entity
            // write already succeeded. App table write failure is observable
            // via logs and can be replayed.
            this.logger.warn(
              {
                event: "l3.normalized_writer_hook_failed",
                traceId,
                normalizedEntityType: canonicalType,
                err: sanitizeErrorObject(hookErr),
              },
              `Hook failure: ${sanitizeError(hookErr)}`,
            );
          }

          // ── Transactional outbox for L3→L4 handoff ──────────────────────────
          await this.normalizationRepository.insertNormalizedOutboxPending(schemaName, traceId, dataSourceId, tx);

          const durationMs = Date.now() - start;
          await this.syncLogRepository.writeSyncLog(
            tenantId,
            schemaName,
            traceId,
            null, // routeId
            "L3",
            "SUCCESS",
            durationMs,
            undefined, // errorMessage
            tx
          );
        }
      });

      // ── Re-queue parent traces from reverse lookup ──────────────────────────
      for (const pTraceId of parentTraceIdsForQueue) {
        // Re-queue the parent so L4 FanOut will process it again
        // now that the required child dependency has been written.
        await this.queueService.send(QueueName.NormalizedQueue, {
          traceId: pTraceId,
          dataSourceId,
        });
        this.logger.debug(
          {
            event: "l3.reverse_lookup.requeued",
            traceId: pTraceId,
            childEntityId: replica.entityId,
            layer: "L3",
          },
          `Re-queued parent traceId ${pTraceId} from reverse lookup of ${canonicalType}`,
        );
      }

      // ── L3→L4 event-driven handoff ────────────────────────────────────────
      // Attempt immediate publish to NormalizedQueue after the transaction
      // commits. This is the happy path — zero delay to L4 FanOut.
      //
      // If publish succeeds → mark normalized_outbox SUCCESS (event is in flight)
      // If publish fails   → leave normalized_outbox PENDING; the recovery
      //                      worker (NormalizedOutboxWorker, every 5 min) will
      //                      retry. This is the crash-recovery path only.
      //
      // IMPORTANT: publish must happen AFTER the transaction — never inside.
      // Publishing inside the transaction creates a dual-write problem: if the
      // transaction rolls back after the queue send, the event is orphaned.
      try {
        await this.queueService.send(QueueName.NormalizedQueue, {
          traceId,
          dataSourceId,
        });

        // Mark outbox row SUCCESS — the event is now in the queue.
        // Uses the same schemaName resolved earlier in processMessage.
        await this.normalizationRepository.markNormalizedOutboxSuccess(tenantId, schemaName, traceId, dataSourceId);

        this.logger.debug(
          { event: "l3.queue_published", traceId, dataSourceId, layer: "L3" },
          "L3→L4: published to NormalizedQueue",
        );
      } catch (publishErr) {
        // Leave normalized_outbox PENDING — recovery worker will retry within 5 min.
        this.logger.warn(
          {
            event: "l3.queue_publish_failed",
            traceId,
            dataSourceId,
            layer: "L3",
            err: sanitizeErrorObject(publishErr),
          },
          `Failed to publish entity state change for routing: ${sanitizeError(publishErr)}`,
        );
      }

      this.logger.log(
        {
          event: "l3.completed",
          traceId,
          dataSourceId,
          layer: "L3",
          durationMs: Date.now() - start,
        },
        "L3 normalization completed",
      );
    } catch (err) {
      const safeErrStr = sanitizeError(err);
      const safeErrObj = sanitizeErrorObject(err);
      this.logger.error(
        {
          event: "l3.error",
          traceId,
          dataSourceId,
          layer: "L3",
          err: safeErrObj,
        },
        `L3 normalization failed: ${safeErrStr}`,
      );
      try {
        const profile =
          await this.storageResolver.resolveStorageProfile(dataSourceId);
        const schemaName = profile.schemaName;
        const tenantId = profile.tenantId;
        const errorMessage = err instanceof Error ? err.message : String(err);
        
        await this.transactionManager.runInTenantTransaction(tenantId, schemaName, async (tx) => {
          await this.syncLogRepository.writeSyncLog(
            tenantId,
            schemaName,
            traceId,
            null, // routeId
            "L3",
            "FAIL",
            Date.now() - start,
            errorMessage,
            tx
          );
        });
      } catch {
        // Swallow rollback errors — original error is rethrown below.
        // The outbox worker will retry on next cycle.
      }
      throw err;
    }
  }
}

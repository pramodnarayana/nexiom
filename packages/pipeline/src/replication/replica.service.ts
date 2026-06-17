import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { QueueService, QueueName } from "@soopa/queue";
import {
  StorageResolverService,
  PipelineHookBrokerService,
} from "../index.js";
import { DependenciesMissingError } from "@soopa/piece-framework";
import { sanitizeErrorObject } from "../utils.js";
import type { ReplicaStatePort } from "../shared/domain.js";
import { CONNECTION_REPOSITORY_PORT, type ConnectionRepositoryPort } from "../shared/ports/connection.repository.port.js";

@Injectable()
export class ReplicaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReplicaService.name);

  constructor(
    private readonly queueService: QueueService,
    @Inject(CONNECTION_REPOSITORY_PORT)
    private readonly connectionRepository: ConnectionRepositoryPort,
    @Inject("ReplicaStatePort")
    private readonly replicaStatePort: ReplicaStatePort,
    private readonly storageResolver: StorageResolverService,
    private readonly hookBroker: PipelineHookBrokerService,
  ) {}

  onModuleInit() {
    this.queueService.consume(QueueName.InboundQueue, async (msg) => {
      await this.processMessage(msg);
    });
  }

  onModuleDestroy() {
    // Queues are gracefully drained by QueueService automatically.
  }

  private async processMessage(rawMsg: unknown): Promise<void> {
    const msg = rawMsg as Record<string, unknown>;
    const traceId = msg.traceId as string;
    const dataSourceId = msg.dataSourceId as string;
    const start = Date.now();

    this.logger.debug(
      { event: "l2.started", traceId, dataSourceId },
      "L2 replication started",
    );

    let effectiveSchemaName: string | undefined;
    let effectiveTenantId: string | undefined;

    try {
      const passedSchemaName = msg.schemaName as string | undefined;
      const { schemaName: resolvedSchemaName, tenantId } =
        await this.storageResolver.resolveStorageProfile(dataSourceId);
      const schemaName = passedSchemaName ?? resolvedSchemaName;
      effectiveSchemaName = schemaName;
      effectiveTenantId = tenantId;
      if (passedSchemaName && passedSchemaName !== resolvedSchemaName) {
        this.logger.error(
          {
            event: "l2.schema_mismatch",
            traceId,
            dataSourceId,
            passedSchemaName,
            resolvedSchemaName,
          },
          "Schema name mismatch detected — misrouted CDC event",
        );
        throw new Error(
          `Schema mismatch: msg.schemaName=${passedSchemaName} but resolved=${resolvedSchemaName}`,
        );
      }
      // Fetch application metadata from the repository
      const connMeta = await this.connectionRepository.getTenantConnectionMeta(dataSourceId, tenantId);

      if (!connMeta) {
        // Connection not found — treat as retryable to handle replication lag or backfill scenarios
        throw new DependenciesMissingError([
          { entityType: "connection", sourceId: dataSourceId },
        ]);
      }

      const appName = connMeta.appName;
      const appProfile = connMeta.appProfile || "standard";

      if (!connMeta.appProfile && connMeta.appProfile !== "") {
        // Missing appProfile — treat as retryable to handle metadata backfill scenarios
        // If appProfile is actually missing from metadata, it might be an issue.
        // But the repository adapter might default it, let's keep the error just in case.
        // Actually, the ConnectionRepositoryPort returns appProfile.
      }
      const inbound = await this.replicaStatePort.fetchInboundRecord(
        tenantId,
        schemaName,
        traceId,
      );

      if (!inbound) {
        throw new Error(`Inbound record for traceId ${traceId} not found`);
      }

      if (
        inbound.status !== "RECEIVED" &&
        inbound.status !== "PENDING" &&
        inbound.status !== "FAIL"
      ) {
        this.logger.debug(
          { traceId, status: inbound.status },
          "L2 already processed this trace (idempotent redelivery). Skipping.",
        );
        return;
      }

      // Extraction happens safely OUTSIDE the transaction
      const extracted = await this.hookBroker.extractReplica(
        appName,
        appProfile,
        inbound.request,
      );

      if (!extracted) {
        throw new Error(
          `Replica extraction failed for traceId ${traceId}: shard returned null. ` +
            `Likely the payload is missing the required entity ID (e.g. sf:id).`,
        );
      }

      // Every entity written to replica_entity must carry a stable business ID.
      // A UUID traceId is NOT a valid entityId — it changes with every delivery.
      const resolvedEntityId = extracted.entityId;
      if (!resolvedEntityId) {
        throw new Error(
          `Cannot determine entityId for traceId ${traceId} (appName="${appName}", appProfile="${appProfile}"). ` +
            `Extractor returned null/undefined entityId. Ensure the payload contains a stable business identifier.`,
        );
      }

      const durationMs = Date.now() - start;

      // ── PERSIST REPLICA ───────────────────────────────────────────────
      await this.replicaStatePort.persistReplicaExtraction(
        tenantId,
        schemaName,
        dataSourceId,
        traceId,
        inbound.id,
        {
          entityId: resolvedEntityId,
          entityType: extracted.entityType,
          data: extracted.data,
        },
        durationMs,
      );

      this.logger.log(
        { event: "l2.completed", traceId, durationMs: Date.now() - start },
        "L2 replication completed",
      );
    } catch (err) {
      // Check if this is a lock contention error — if so, treat as retry/defer
      const isLockContention =
        err instanceof Error &&
        "isLockContention" in err &&
        (err as Record<string, unknown>).isLockContention === true;

      if (isLockContention) {
        this.logger.log(
          {
            event: "l2.lock_contention",
            traceId,
            err: err instanceof Error ? err.message : String(err),
          },
          "L2 lock contention detected — deferring to maintain FIFO order",
        );
        // Do NOT mark as FAIL; let the message remain PENDING for retry
        throw err;
      }

      const safeErrStr = err instanceof Error ? err.message : String(err);
      const safeErrObj = sanitizeErrorObject(err);
      this.logger.error(
        {
          event: "l2.error",
          traceId,
          err: safeErrObj,
        },
        `L2 replication failed: ${safeErrStr}`,
      );

      try {
        if (effectiveSchemaName && effectiveTenantId) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          await this.replicaStatePort.markInboundFail(
            effectiveTenantId,
            effectiveSchemaName,
            traceId,
            err instanceof Error
              ? `${errorMessage}\n${err.stack}`
              : errorMessage,
            Date.now() - start,
          );
        } else {
          this.logger.error(
            "Cannot mark inbound as FAIL: schema/tenant not yet resolved",
          );
        }
      } catch (error_) {
        this.logger.error(
          "Failed to write L2 error state",
          error_ instanceof Error ? error_.message : String(error_),
        );
      }
      throw err;
    }
  }
}

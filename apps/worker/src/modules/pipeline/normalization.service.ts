import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { eq } from "drizzle-orm";
import { QueueService, QueueName } from "@nexiom/queue";
import {
  DATABASE_CONNECTION,
  buildTenantSchema,
  assertValidSchemaName,
  appConnections,
} from "@nexiom/database";
import type { DrizzleDb } from "@nexiom/database";
import { StorageResolverService } from "@nexiom/engine";
import { PieceRegistryService } from "@nexiom/piece-registry";
import { sql } from "drizzle-orm";
import {
  sanitizeError,
  isValidPipelineMessage,
} from "../../shared/pipeline.utils.js";
import { getNormalizer } from "@nexiom/piece-framework";

@Injectable()
export class NormalizationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NormalizationService.name);

  constructor(
    private readonly queueService: QueueService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly storageResolver: StorageResolverService,
    private readonly pieceRegistry: PieceRegistryService,
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
    if (!isValidPipelineMessage(msg, ["traceId", "connectionId"])) {
      this.logger.warn(
        {
          event: "l3.invalid_message",
          layer: "L3",
          msg: JSON.stringify(msg).slice(0, 200),
        },
        "L3: dropping invalid message — missing traceId or connectionId",
      );
      return;
    }

    const traceId = msg.traceId as string;
    const connectionId = msg.connectionId as string;
    const start = Date.now();

    this.logger.debug(
      { event: "l3.started", traceId, connectionId, layer: "L3" },
      "L3 normalization started",
    );

    try {
      const passedSchemaName = msg.schemaName as string | undefined;
      let schemaName: string;

      if (passedSchemaName) {
        // Validate syntax
        assertValidSchemaName(passedSchemaName);

        // Verify ownership: passedSchemaName must belong to this connectionId
        const expectedSchemaName =
          await this.storageResolver.resolveSchemaName(connectionId);

        if (passedSchemaName !== expectedSchemaName) {
          throw new Error(
            `Schema ownership mismatch: passedSchemaName="${passedSchemaName}" does not belong to connectionId="${connectionId}" (expected="${expectedSchemaName}")`,
          );
        }

        schemaName = passedSchemaName;
      } else {
        schemaName = await this.storageResolver.resolveSchemaName(connectionId);
      }
      const {
        inboundGateway,
        replicaEntity,
        normalizedEntity,
        normalizedOutbox,
        syncLog,
      } = buildTenantSchema(schemaName);

      // ── Resolve piece for this connection ─────────────────────────────────
      // Query the public-schema app_connection table using typed Drizzle columns
      // to get the appName needed for piece resolution. Never use raw sql`` here
      // — appConnections provides compile-time safety and prevents SQL injection.
      const connRows = await this.db
        .select({
          appName: appConnections.appName,
          metadata: appConnections.metadata,
        })
        .from(appConnections)
        .where(eq(appConnections.id, connectionId))
        .limit(1);

      if (!connRows[0]) {
        throw new Error(
          `Connection ${connectionId} not found in app_connection`,
        );
      }
      const connectionAppName = connRows[0].appName;
      const metadata = connRows[0].metadata as Record<string, unknown> | null;

      // Runtime validation of appProfile
      const trimmedAppProfile =
        typeof metadata?.appProfile === "string"
          ? metadata.appProfile.trim()
          : "";
      const appProfile =
        trimmedAppProfile !== "" ? trimmedAppProfile : "default";

      const piece = this.pieceRegistry.getPiece(connectionAppName);
      if (!piece) {
        throw new Error(
          `Piece "${connectionAppName}" not registered in PieceRegistry`,
        );
      }

      const replica = await this.db.transaction(async (tx) => {
        assertValidSchemaName(schemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
        );

        const replicaRows = await tx
          .select()
          .from(replicaEntity)
          .where(sql`${replicaEntity.traceId} = ${traceId}`)
          .limit(1);
        const rep = replicaRows[0];
        if (!rep)
          throw new Error(`Replica record for traceId ${traceId} not found`);
        return rep;
      });

      let canonicalType = "RAW";
      let canonicalData = replica.data;

      // ── Normalize via Registry or Piece ─────────────────────────────────
      const customNormalizer = getNormalizer(connectionAppName, appProfile);

      if (customNormalizer) {
        const normalized = await customNormalizer({
          entityType: replica.entityType,
          data: replica.data as Record<string, unknown>,
        });
        if (normalized) {
          canonicalType = normalized.canonicalType;
          canonicalData = normalized.data;
        }
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

      await this.db.transaction(async (tx) => {
        assertValidSchemaName(schemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
        );

        // ── Idempotent upsert of normalizedEntity ────────────────────────────
        // ON CONFLICT DO UPDATE on replicaId overwrites data/canonicalType with
        // the latest version whenever the same entity is re-ingested.
        //
        // safeData guard: JSON round-trip ensures a plain-prototype object is
        // passed to Drizzle, avoiding null-prototype crashes in Drizzle's is().
        const safeData = JSON.parse(
          JSON.stringify(
            canonicalData != null && typeof canonicalData === "object"
              ? canonicalData
              : {},
          ),
        ) as Record<string, unknown>;

        // onConflictDoUpdate always returns the row, so insertRes is always non-empty.
        const insertRes = await tx
          .insert(normalizedEntity)
          .values({
            traceId,
            replicaId: replica.id,
            canonicalType,
            data: safeData,
          })
          .onConflictDoUpdate({
            target: normalizedEntity.replicaId,
            set: {
              // Always overwrite with the latest normalised payload
              traceId,
              canonicalType,
              data: safeData,
            },
          })
          .returning({ id: normalizedEntity.id });

        if (insertRes.length > 0) {
          // ── Transactional outbox for L3→L4 handoff ──────────────────────────
          // The unique constraint idx_normalized_outbox_trace on (traceId, connectionId)
          // ensures the outbox row is not duplicated on replay.
          await tx
            .insert(normalizedOutbox)
            .values({
              traceId,
              connectionId,
              status: "PENDING",
            })
            .onConflictDoNothing({
              target: [normalizedOutbox.traceId, normalizedOutbox.connectionId],
            });

          // Mark inbound gateway as NORMALIZED (idempotent guard on status)
          await tx
            .update(inboundGateway)
            .set({ status: "NORMALIZED" })
            .where(
              sql`${inboundGateway.traceId} = ${traceId} AND ${inboundGateway.status} != 'NORMALIZED'`,
            );

          const durationMs = Date.now() - start;
          // onConflictDoNothing on (traceId, layer, status) prevents duplicate audit
          // rows on replay — matches unique constraint uq_sync_log_trace_layer_status.
          await tx
            .insert(syncLog)
            .values({
              traceId,
              layer: "L3",
              status: "SUCCESS",
              durationMs,
            })
            .onConflictDoNothing({
              // uq_sync_log_unrouted covers (traceId, layer, status) where routeId IS NULL
              target: [syncLog.traceId, syncLog.layer, syncLog.status],
              where: sql`${syncLog.routeId} IS NULL`,
            });
        }
      });

      this.logger.log(
        {
          event: "l3.completed",
          traceId,
          connectionId,
          layer: "L3",
          durationMs: Date.now() - start,
        },
        "L3 normalization completed",
      );
    } catch (err) {
      const safeErr = sanitizeError(err);
      this.logger.error(
        {
          event: "l3.error",
          traceId,
          connectionId,
          layer: "L3",
          err: safeErr,
        },
        "L3 normalization failed",
      );
      try {
        const schemaName =
          await this.storageResolver.resolveSchemaName(connectionId);
        const { syncLog, inboundGateway } = buildTenantSchema(schemaName);
        await this.db.transaction(async (tx) => {
          assertValidSchemaName(schemaName);
          await tx.execute(
            sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
          );

          // Only mark FAIL if not already in a terminal state
          // (NORMALIZED means the happy path already won — do not overwrite)
          await tx
            .update(inboundGateway)
            .set({ status: "FAIL" })
            .where(
              sql`${inboundGateway.traceId} = ${traceId} AND ${inboundGateway.status} != 'NORMALIZED' AND ${inboundGateway.status} != 'FAIL'`,
            );

          // onConflictDoNothing prevents uq_sync_log_trace_layer_status violations on
          // replay — if a FAIL row for this trace/layer already exists, skip silently.
          await tx
            .insert(syncLog)
            .values({
              traceId,
              layer: "L3",
              status: "FAIL",
              durationMs: Date.now() - start,
            })
            .onConflictDoNothing({
              // uq_sync_log_unrouted covers (traceId, layer, status) where routeId IS NULL
              target: [syncLog.traceId, syncLog.layer, syncLog.status],
              where: sql`${syncLog.routeId} IS NULL`,
            });
        });
      } catch {
        // Swallow rollback errors — original error is rethrown below.
        // The outbox worker will retry on next cycle.
      }
      throw err;
    }
  }
}

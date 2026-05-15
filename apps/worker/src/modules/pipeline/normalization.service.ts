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
import {
  StorageResolverService,
  PipelineHookBrokerService,
} from "@nexiom/engine";
import { DB_MANAGER, type TenantDatabaseManager } from "@nexiom/dbmanager";
import { PieceRegistryService } from "@nexiom/piece-registry";
import { sql } from "drizzle-orm";
import {
  sanitizeError,
  isValidPipelineMessage,
} from "../../shared/pipeline.utils.js";

@Injectable()
export class NormalizationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NormalizationService.name);

  constructor(
    private readonly queueService: QueueService,
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: TenantDatabaseManager,
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
      let tenantId: string;

      if (passedSchemaName) {
        // Validate syntax
        assertValidSchemaName(passedSchemaName);

        // Verify ownership: passedSchemaName must belong to this connectionId
        const profile =
          await this.storageResolver.resolveStorageProfile(connectionId);
        const expectedSchemaName = profile.schemaName;

        if (passedSchemaName !== expectedSchemaName) {
          throw new Error(
            `Schema ownership mismatch: passedSchemaName="${passedSchemaName}" does not belong to connectionId="${connectionId}" (expected="${expectedSchemaName}")`,
          );
        }

        schemaName = passedSchemaName;
        tenantId = profile.tenantId;
      } else {
        const profile =
          await this.storageResolver.resolveStorageProfile(connectionId);
        schemaName = profile.schemaName;
        tenantId = profile.tenantId;
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
      const connRows = await this.globalDb
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

      const tenantDb = await this.dbManager.getTenantDb(tenantId);
      const replicaOrSuperseded = await tenantDb.transaction(async (tx) => {
        assertValidSchemaName(schemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
        );

        // ── Primary lookup: exact traceId match ──────────────────────────────
        // Happy-path: the L2 UPSERT wrote this row and traceId still matches.
        const exactRows = await tx
          .select()
          .from(replicaEntity)
          .where(sql`${replicaEntity.traceId} = ${traceId}`)
          .limit(1);

        if (exactRows[0])
          return { kind: "found" as const, replica: exactRows[0] };

        // ── Superseded check ─────────────────────────────────────────────────
        // The traceId does NOT match. This happens when:
        //   1. A later Update event already UPSERTed the same entity row and
        //      overwrote traceId with a newer trace.
        //   2. SQS redelivers the old message after a worker crash/restart.
        //
        // We cannot use entityId here because we don't have it in the queue
        // message — but we can check whether ANY replica_entity row exists
        // for this connectionId whose traceId differs. If yes, the event is
        // superseded and we ACK it silently.  If none exist, the L2 write
        // never committed — rethrow so the message retries.
        const anyRows = await tx
          .select({ id: replicaEntity.id, traceId: replicaEntity.traceId })
          .from(replicaEntity)
          .where(
            sql`${replicaEntity.connectionId} = ${connectionId}
                AND ${replicaEntity.traceId} != ${traceId}`,
          )
          .limit(1);

        if (anyRows.length > 0) {
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
            connectionId,
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
        })
        .catch((err) => {
          // Log the error for operational visibility, then fall through to piece.normalize
          this.logger.warn(
            {
              event: "l3.shard_normalize_failed",
              connectionAppName,
              appProfile,
              entityType: replica.entityType,
              err: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            },
            "Shard normalize failed — falling back to piece.normalize",
          );
          return null;
        }); // shard may not exist yet — fall through to piece.normalize

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

      await tenantDb.transaction(async (tx) => {
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
              // traceId MUST be updated so L4 FanOut can find it by the current traceId
              traceId,
              canonicalType,
              data: safeData,
            },
          })
          .returning({ id: normalizedEntity.id });

        if (insertRes.length > 0) {
          // ── Step 3.5: Application canonical write hook ─────────────────────
          // Delegates to the application shard's writeNormalized function.
          // The shard receives the live Drizzle savepoint and executes its own
          // upserts into application-owned tables (e.g. tms_carrier, tms_tp).
          // The platform knows nothing about those tables — only the shard does.
          let parentTraceIds: string[] = [];
          try {
            await tx.transaction(async (sp) => {
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
              // Re-queue the parent so L4 FanOut will process it again
              // now that the required child dependency has been written.
              await this.queueService.send(QueueName.NormalizedQueue, {
                traceId: pTraceId,
                connectionId,
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
          } catch (hookErr) {
            // Log but do not fail the pipeline — the generic normalized_entity
            // write already succeeded. App table write failure is observable
            // via logs and can be replayed.
            this.logger.warn(
              {
                event: "l3.normalized_writer_hook_failed",
                traceId,
                normalizedEntityType: canonicalType,
                err: sanitizeError(hookErr),
              },
              "App normalized writer hook failed — typed table write skipped",
            );
          }

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
          connectionId,
        });

        // Mark outbox row SUCCESS — the event is now in the queue.
        // Uses the same schemaName resolved earlier in processMessage.
        await tenantDb
          .update(normalizedOutbox)
          .set({ status: "SUCCESS" })
          .where(
            sql`${normalizedOutbox.traceId} = ${traceId} AND ${normalizedOutbox.connectionId} = ${connectionId}`,
          );

        this.logger.debug(
          { event: "l3.queue_published", traceId, connectionId, layer: "L3" },
          "L3→L4: published to NormalizedQueue",
        );
      } catch (publishErr) {
        // Leave normalized_outbox PENDING — recovery worker will retry within 5 min.
        this.logger.warn(
          {
            event: "l3.queue_publish_failed",
            traceId,
            connectionId,
            layer: "L3",
            err: sanitizeError(publishErr),
          },
          "L3→L4: failed to publish to NormalizedQueue — outbox recovery will retry",
        );
      }

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
        const profile =
          await this.storageResolver.resolveStorageProfile(connectionId);
        const schemaName = profile.schemaName;
        const tenantId = profile.tenantId;
        const { syncLog, inboundGateway } = buildTenantSchema(schemaName);
        const tenantDb = await this.dbManager.getTenantDb(tenantId);
        await tenantDb.transaction(async (tx) => {
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

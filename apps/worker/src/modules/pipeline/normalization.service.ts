import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { QueueService, QueueName } from "@nexiom/queue";
import {
  DATABASE_CONNECTION,
  buildTenantSchema,
  assertValidSchemaName,
} from "@nexiom/database";
import type { DrizzleDb } from "@nexiom/database";
import { StorageResolverService, PieceRegistryService } from "@nexiom/engine";
import { sql } from "drizzle-orm";

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
    const traceId = msg.traceId as string;
    const connectionId = msg.connectionId as string;
    const start = Date.now();

    this.logger.debug(
      { event: "l3.started", traceId, connectionId },
      "L3 normalization started",
    );

    try {
      const schemaName =
        await this.storageResolver.resolveSchemaName(connectionId);
      const { inboundGateway, replicaEntity, normalizedEntity, syncLog } =
        buildTenantSchema(schemaName);

      let connectionAppName = "";

      // Get connection details to resolve piece
      const connDocs = await this.db
        .select({ appName: sql<string>`app_name` })
        .from(sql`app_connection`)
        .where(sql`id = ${connectionId}`)
        .limit(1);

      if (!connDocs[0]) {
        throw new Error(`Connection ${connectionId} not found`);
      }
      connectionAppName = connDocs[0].appName;

      const piece = this.pieceRegistry.getPiece(connectionAppName);
      if (!piece) {
        throw new Error(`Piece ${connectionAppName} not registered`);
      }

      // Hoisted so it is readable after the transaction resolves.
      let isNewlyPublished = false;

      await this.db.transaction(async (tx) => {
        assertValidSchemaName(schemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
        );

        const replicaRows = await tx
          .select()
          .from(replicaEntity)
          .where(sql`${replicaEntity.traceId} = ${traceId}`)
          .limit(1);
        const replica = replicaRows[0];
        if (!replica)
          throw new Error(`Replica record for traceId ${traceId} not found`);

        let canonicalType = "RAW";
        let canonicalData = replica.data;

        if (piece.normalize) {
          const normalized = await piece.normalize(
            replica.entityType,
            replica.data as Record<string, unknown>,
          );
          if (normalized) {
            canonicalType = normalized.canonicalType;
            canonicalData = normalized.data;
          }
        }

        // Insert normalizedEntity idempotently (ON CONFLICT DO NOTHING on replicaId)
        await tx
          .insert(normalizedEntity)
          .values({
            traceId,
            replicaId: replica.id,
            canonicalType,
            data: canonicalData as any,
          })
          .onConflictDoNothing({ target: normalizedEntity.replicaId });

        const updateRes = await tx.execute(
          sql`UPDATE ${normalizedEntity}
              SET    published_at = NOW()
              WHERE  ${normalizedEntity.replicaId} = ${replica.id}
                AND  published_at IS NULL`,
        );
        isNewlyPublished =
          (updateRes as unknown as { rowCount: number }).rowCount > 0;
      });

      if (isNewlyPublished) {
        // Publish to the next queue — only if this worker thread won the race to stamp published_at
        await this.queueService.send(QueueName.NormalizedQueue, {
          traceId,
          connectionId,
        });
      } else {
        this.logger.debug(
          { event: "l3.skip_enqueue", traceId },
          "L3 already published — skipping duplicate enqueue",
        );
      }

      // 3. Mark NORMALIZED and write L3/SUCCESS audit — runs only after send() resolves
      await this.db.transaction(async (tx) => {
        assertValidSchemaName(schemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
        );

        await tx
          .update(inboundGateway)
          .set({ status: "NORMALIZED" })
          .where(
            sql`${inboundGateway.traceId} = ${traceId} AND ${inboundGateway.status} != 'NORMALIZED'`,
          );

        const durationMs = Date.now() - start;
        // Idempotent insert: ignore if an L3/SUCCESS row already exists for this traceId
        await tx
          .insert(syncLog)
          .values({
            traceId,
            layer: "L3",
            status: "SUCCESS",
            durationMs,
          })
          .onConflictDoNothing({
            target: [syncLog.traceId, syncLog.layer, syncLog.status],
          });
      });

      this.logger.log(
        { event: "l3.completed", traceId, durationMs: Date.now() - start },
        "L3 normalization completed",
      );
    } catch (err) {
      this.logger.error(
        {
          event: "l3.error",
          traceId,
          err: err instanceof Error ? err.message : String(err),
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

          // Only mark FAIL if not already in a terminal state (NORMALIZED = happy path won)
          await tx
            .update(inboundGateway)
            .set({ status: "FAIL" })
            .where(
              sql`${inboundGateway.traceId} = ${traceId} AND ${inboundGateway.status} != 'NORMALIZED' AND ${inboundGateway.status} != 'FAIL'`,
            );

          await tx
            .insert(syncLog)
            .values({
              traceId,
              layer: "L3",
              status: "FAIL",
              durationMs: Date.now() - start,
            })
            .onConflictDoNothing({
              target: [syncLog.traceId, syncLog.layer, syncLog.status],
            });
        });
      } catch {
        // ignore rollback errors
      }
      throw err;
    }
  }
}

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

        const inboundRows = await tx
          .select()
          .from(inboundGateway)
          .where(sql`${inboundGateway.traceId} = ${traceId}`)
          .limit(1);
        const inbound = inboundRows[0];

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

        // Insert into normalized_entity
        await tx.insert(normalizedEntity).values({
          traceId,
          replicaId: replica.id,
          canonicalType,
          data: canonicalData as any,
        });

        if (inbound) {
          await tx
            .update(inboundGateway)
            .set({ status: "NORMALIZED" })
            .where(sql`${inboundGateway.id} = ${inbound.id}`);
        }

        const durationMs = Date.now() - start;
        await tx.insert(syncLog).values({
          traceId,
          layer: "L3",
          status: "SUCCESS",
          durationMs,
        });
      });

      await this.queueService.send(QueueName.NormalizedQueue, {
        traceId,
        connectionId,
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
        const { syncLog } = buildTenantSchema(schemaName);
        await this.db.transaction(async (tx) => {
          assertValidSchemaName(schemaName);
          await tx.execute(
            sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
          );
          await tx.insert(syncLog).values({
            traceId,
            layer: "L3",
            status: "FAIL",
            durationMs: Date.now() - start,
          });
        });
      } catch {
        // ignore rollback errors
      }
      throw err;
    }
  }
}

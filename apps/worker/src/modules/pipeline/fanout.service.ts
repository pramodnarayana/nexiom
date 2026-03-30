/* eslint-disable @typescript-eslint/no-unsafe-assignment */
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
  integrationStitches,
  fieldMappings,
} from "@nexiom/database";
import type { DrizzleDb } from "@nexiom/database";
import {
  StorageResolverService,
  evaluateConditions,
  hydratePayload,
  Condition,
} from "@nexiom/engine";
import { sql } from "drizzle-orm";

@Injectable()
export class FanOutService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FanOutService.name);

  constructor(
    private readonly queueService: QueueService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly storageResolver: StorageResolverService,
  ) {}

  onModuleInit() {
    this.queueService.consume(QueueName.NormalizedQueue, async (msg) => {
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
      { event: "l4.started", traceId, connectionId },
      "L4 fan-out started",
    );

    try {
      // 1. Get stitches matching srcConnectionId = connectionId
      const stitches = await this.db
        .select()
        .from(integrationStitches)
        .where(
          sql`${integrationStitches.srcConnectionId} = ${connectionId} AND ${integrationStitches.status} = 'ACTIVE'`,
        );

      if (stitches.length === 0) {
        this.logger.debug(
          { event: "l4.no_routes", traceId },
          "No active stitches found for source connection",
        );
        return;
      }

      const schemaName =
        await this.storageResolver.resolveSchemaName(connectionId);
      const { normalizedEntity, outboundGateway, deliveryOutbox, syncLog } =
        buildTenantSchema(schemaName);

      let normalizedData: any = null;
      let canonicalType = "";

      await this.db.transaction(async (tx) => {
        assertValidSchemaName(schemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
        );

        const normRows = await tx
          .select()
          .from(normalizedEntity)
          .where(sql`${normalizedEntity.traceId} = ${traceId}`)
          .limit(1);
        if (!normRows.length) throw new Error("Normalized record not found");
        normalizedData = normRows[0].data;
        canonicalType = normRows[0].canonicalType;
      });

      for (const stitch of stitches) {
        try {
          const conditions = stitch.syncCondition as Condition[];
          const matched = evaluateConditions(conditions, normalizedData);

          if (!matched) {
            await this.writeSyncLog(
              schemaName,
              traceId,
              stitch.id,
              "L4",
              "SKIPPED",
              Date.now() - start,
            );
            continue;
          }

          // Hydrate payload
          const mappings = await this.db
            .select()
            .from(fieldMappings)
            .where(
              sql`${fieldMappings.stitchId} = ${stitch.id} AND ${fieldMappings.sourceCanonical} = ${canonicalType}`,
            )
            .limit(1);

          let hydratedPayload = normalizedData;
          if (mappings.length > 0) {
            hydratedPayload = hydratePayload(
              mappings[0].mappingRules as import("@nexiom/engine").Rule[],
              normalizedData as Record<string, unknown>,
            );
          }

          await this.db.transaction(async (tx) => {
            assertValidSchemaName(schemaName);
            await tx.execute(
              sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
            );

            const successLogs = await tx
              .select()
              .from(syncLog)
              .where(
                sql`${syncLog.traceId} = ${traceId} AND ${syncLog.routeId} = ${stitch.id} AND ${syncLog.layer} = 'L4' AND ${syncLog.status} = 'SUCCESS'`,
              )
              .limit(1);

            if (successLogs.length > 0) {
              this.logger.debug(
                { event: "l4.skip_success", traceId, routeId: stitch.id },
                "Route already succeeded previously, skipping",
              );
              return;
            }

            const [outbound] = await tx
              .insert(outboundGateway)
              .values({
                traceId,
                routeId: stitch.id,
                reqPayload: hydratedPayload,
                status: "PENDING",
              })
              .onConflictDoUpdate({
                target: [outboundGateway.traceId, outboundGateway.routeId],
                set: {
                  // Merge updated payload in case mappings changed, reset status for re-delivery
                  reqPayload: hydratedPayload,
                  status: "PENDING",
                  attemptCount: sql`${outboundGateway.attemptCount} + 1`,
                  updatedAt: sql`NOW()`,
                },
              })
              .returning({ id: outboundGateway.id });

            // Write atomical outbox handoff to L5 DeliveryQueue
            await tx.insert(deliveryOutbox).values({
              payload: {
                traceId,
                connectionId,
                targetConnectionId: stitch.destConnectionId,
                routeId: stitch.id,
                outboundGatewayId: outbound.id,
              },
              status: "PENDING",
            });

            // Write syncLog L4/SUCCESS identically inside single transaction
            await tx.insert(syncLog).values({
              traceId,
              routeId: stitch.id,
              layer: "L4",
              status: "SUCCESS",
              durationMs: Date.now() - start,
            });
          });
        } catch (err) {
          this.logger.error(
            {
              event: "l4.stitch_error",
              stitchId: stitch.id,
              traceId,
              err: err instanceof Error ? err.message : String(err),
            },
            "L4 stitch fan-out failed, recording failure and continuing to next route",
          );
          await this.writeSyncLog(
            schemaName,
            traceId,
            stitch.id,
            "L4",
            "FAIL",
            Date.now() - start,
          );
        }
      }

      this.logger.log(
        { event: "l4.completed", traceId },
        "L4 fan-out completed",
      );
    } catch (err) {
      this.logger.error(
        {
          event: "l4.error",
          traceId,
          err: err instanceof Error ? err.message : String(err),
        },
        "L4 fan-out failed",
      );
      throw err;
    }
  }

  private async writeSyncLog(
    schemaName: string,
    traceId: string,
    routeId: string,
    layer: "L1" | "L2" | "L3" | "L4" | "L5",
    status: "PROCESSING" | "SUCCESS" | "FAIL" | "SKIPPED",
    durationMs: number,
  ) {
    const { syncLog } = buildTenantSchema(schemaName);
    await this.db.transaction(async (tx) => {
      assertValidSchemaName(schemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );
      await tx.insert(syncLog).values({
        traceId,
        routeId,
        layer,
        status,
        durationMs,
      });
    });
  }
}

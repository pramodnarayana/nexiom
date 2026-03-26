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
} from "@nexiom/database";
import type { DrizzleDb } from "@nexiom/database";
import { StorageResolverService, PieceRegistryService } from "@nexiom/engine";
import { sql } from "drizzle-orm";
// Replace with actual TokenRefreshService later
// import { TokenRefreshService } from '../connections/token-refresh.service.js';

@Injectable()
export class DeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly queueService: QueueService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly storageResolver: StorageResolverService,
    private readonly pieceRegistry: PieceRegistryService,
    // private readonly tokenRefreshService: TokenRefreshService
  ) {}

  onModuleInit() {
    this.queueService.consume(QueueName.DeliveryQueue, async (msg) => {
      await this.processMessage(msg);
    });
  }

  onModuleDestroy() {}

  private async processMessage(rawMsg: unknown): Promise<void> {
    const msg = rawMsg as Record<string, unknown>;
    const traceId = msg.traceId as string;
    const connectionId = msg.connectionId as string;
    const targetConnectionId = msg.targetConnectionId as string;
    const routeId = msg.routeId as string;
    const outboundGatewayId = msg.outboundGatewayId as string;
    const start = Date.now();

    this.logger.debug(
      { event: "l5.started", traceId, connectionId },
      "L5 Delivery started",
    );

    try {
      const srcSchemaName =
        await this.storageResolver.resolveSchemaName(connectionId);
      const { outboundGateway } = buildTenantSchema(srcSchemaName);

      let reqPayload: any;
      await this.db.transaction(async (tx) => {
        assertValidSchemaName(srcSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + srcSchemaName + '"')}`,
        );
        const ob = await tx
          .select()
          .from(outboundGateway)
          .where(sql`${outboundGateway.id} = ${outboundGatewayId}`)
          .limit(1);
        if (!ob.length) throw new Error("Outbound gateway record not found");
        reqPayload = ob[0].reqPayload;
      });

      // TODO: Acquire Redis refresh lock lock:refresh:{targetConnectionId}
      // const credentials = await this.tokenRefreshService.getValidCredentials(targetConnectionId);
      const credentials = {};

      // Get target piece details
      let targetAppName = "";
      const connDocs = await this.db
        .select({ appName: sql<string>`app_name` })
        .from(sql`app_connection`)
        .where(sql`id = ${targetConnectionId}`)
        .limit(1);

      if (!connDocs.length)
        throw new Error(`Target connection ${targetConnectionId} not found`);
      targetAppName = connDocs[0].appName;

      const piece = this.pieceRegistry.getPiece(targetAppName);
      if (!piece) throw new Error(`Piece ${targetAppName} not registered`);

      const stitchDocs = await this.db
        .select()
        .from(integrationStitches)
        .where(sql`id = ${routeId}`)
        .limit(1);
      const targetObject = stitchDocs[0]?.targetObject ?? "";

      let resPayload: any = null;
      let statusCode = 200;

      if (piece.executeAction) {
        const resp = await piece.executeAction(
          targetObject,
          reqPayload as Record<string, unknown>,
          credentials,
        );
        resPayload = resp.body;
        statusCode = resp.statusCode;
      }

      // L6: GEM write + final audit
      await this.db.transaction(async (tx) => {
        assertValidSchemaName(srcSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + srcSchemaName + '"')}`,
        );

        await tx
          .update(outboundGateway)
          .set({ resPayload, statusCode, status: "SUCCESS" })
          .where(sql`${outboundGateway.id} = ${outboundGatewayId}`);

        const { syncLog } = buildTenantSchema(srcSchemaName);
        await tx.insert(syncLog).values({
          traceId,
          routeId,
          layer: "L6",
          status: "SUCCESS",
          durationMs: Date.now() - start,
        });
      });

      this.logger.log(
        { event: "l6.completed", traceId },
        "L6 delivery completed",
      );
    } catch (err: any) {
      // On failure, update outbound_gateway and log FAIL
      try {
        const srcSchemaName =
          await this.storageResolver.resolveSchemaName(connectionId);
        await this.db.transaction(async (tx) => {
          assertValidSchemaName(srcSchemaName);
          await tx.execute(
            sql`SET LOCAL search_path TO ${sql.raw('"' + srcSchemaName + '"')}`,
          );
          const { outboundGateway, syncLog } = buildTenantSchema(srcSchemaName);
          await tx
            .update(outboundGateway)
            .set({ status: "FAIL" })
            .where(sql`${outboundGateway.id} = ${outboundGatewayId}`);
          await tx.insert(syncLog).values({
            traceId,
            routeId,
            layer: "L6",
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

import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
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
import { TokenManagerService } from "@nexiom/connectors";

@Injectable()
export class DeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly queueService: QueueService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly storageResolver: StorageResolverService,
    private readonly pieceRegistry: PieceRegistryService,
    @Optional() private readonly tokenManagerService?: TokenManagerService,
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

      if (!this.tokenManagerService) {
        this.logger.warn(
          "TokenManagerService not available; skipping delivery to prevent empty credentials",
        );
        return;
      }

      const credentials =
        await this.tokenManagerService.getValidCredentials(targetConnectionId);

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

      if (!piece.executeAction) {
        throw new Error(`Piece ${targetAppName} has no executeAction defined`);
      }

      // 2. Add a durable claim/idempotency record before external side effects
      let claimed = false;
      await this.db.transaction(async (tx) => {
        assertValidSchemaName(srcSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + srcSchemaName + '"')}`,
        );
        const claimRes = await tx
          .update(outboundGateway)
          .set({
            status: "PROCESSING",
            attemptCount: sql`${outboundGateway.attemptCount} + 1`,
          })
          .where(
            sql`${outboundGateway.id} = ${outboundGatewayId} AND (${outboundGateway.status} = 'PENDING' OR ${outboundGateway.status} = 'FAIL')`,
          )
          .returning({ id: outboundGateway.id });

        if (claimRes.length > 0) claimed = true;
      });

      if (!claimed) {
        this.logger.warn(
          { event: "l5.claim_failed", outboundGatewayId },
          "Delivery already claimed or completed by another worker",
        );
        return;
      }

      const stitchDocs = await this.db
        .select()
        .from(integrationStitches)
        .where(sql`id = ${routeId}`)
        .limit(1);
      const targetObject = stitchDocs[0]?.targetObject ?? "";

      // 3. Call piece.executeAction and derive success/failure
      let resPayload: any = null;
      let statusCode = 500;
      let finalStatus: "SUCCESS" | "FAIL" = "FAIL";

      try {
        const resp = await piece.executeAction(
          targetObject,
          reqPayload as Record<string, unknown>,
          credentials as unknown as Record<string, unknown>,
        );
        resPayload = resp.body;
        statusCode = resp.statusCode ?? 200;
        finalStatus =
          statusCode >= 200 && statusCode < 300 ? "SUCCESS" : "FAIL";
      } catch (error_: unknown) {
        // If the piece throws an unhandled error, we still consider it a failed delivery
        // and capture the error message to persist in L6.
        statusCode =
          typeof error_ === "object" &&
          error_ !== null &&
          "statusCode" in error_
            ? Number((error_ as Record<string, unknown>).statusCode) || 500
            : 500;

        const errorMessage =
          error_ instanceof Error ? error_.message : String(error_);
        resPayload = { error: errorMessage };
        finalStatus = "FAIL";
        this.logger.error(
          { event: "l5.execute_failed", err: errorMessage },
          "Piece executeAction threw an error",
        );
      }

      // 4. L6: Persist result and set status according to external API response
      await this.db.transaction(async (tx) => {
        assertValidSchemaName(srcSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + srcSchemaName + '"')}`,
        );

        await tx
          .update(outboundGateway)
          .set({ resPayload, statusCode, status: finalStatus })
          .where(sql`${outboundGateway.id} = ${outboundGatewayId}`);

        const { syncLog } = buildTenantSchema(srcSchemaName);
        await tx.insert(syncLog).values({
          traceId,
          routeId,
          layer: "L6",
          status: finalStatus,
          durationMs: Date.now() - start,
        });
      });

      this.logger.log(
        { event: "l6.completed", traceId, finalStatus },
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

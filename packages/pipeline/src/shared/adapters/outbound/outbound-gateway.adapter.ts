import { Injectable, Inject } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DB_MANAGER } from "@soopa/dbmanager";
import type { DatabaseManager } from "@soopa/dbmanager";
import { buildTenantSchema, assertValidSchemaName } from "@soopa/database";
import type {
  OutboundGatewayPort,
  OutboundGatewayRecord,
} from '../../domain.js';

@Injectable()
export class OutboundGatewayAdapter implements OutboundGatewayPort {
  constructor(
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  async insertOrFetchPending(
    tenantId: string,
    destSchemaName: string,
    record: Omit<OutboundGatewayRecord, "id" | "status" | "attempts">,
  ): Promise<{ id: string; attempts: number; status: string }> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    let result = { id: "", attempts: 0, status: "" };

    await tenantDb.transaction(async (tx) => {
      assertValidSchemaName(destSchemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
      );

      const { outboundGateway } = buildTenantSchema(destSchemaName);

      await tx
        .insert(outboundGateway)
        .values({
          traceId: record.traceId,
          routeId: record.routeId,
          dataSourceId: record.dataSourceId,
          srcDataSourceId: record.srcDataSourceId,
          payload: record.payload,
          status: "PENDING",
          attempts: 0,
        })
        .onConflictDoNothing({
          target: [outboundGateway.traceId, outboundGateway.routeId],
        });

      const ob = await tx
        .select({
          id: outboundGateway.id,
          attempts: outboundGateway.attempts,
          status: outboundGateway.status,
        })
        .from(outboundGateway)
        .where(
          sql`${outboundGateway.traceId} = ${record.traceId} AND ${outboundGateway.routeId} = ${record.routeId}`,
        )
        .limit(1);

      if (!ob.length) throw new Error("Outbound gateway record not found");
      result = {
        id: ob[0].id,
        attempts: ob[0].attempts ?? 0,
        status: ob[0].status,
      };
    });

    return result;
  }

  async claimForProcessing(
    tenantId: string,
    destSchemaName: string,
    id: string,
  ): Promise<{ claimed: boolean; attemptCount: number }> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    let claimed = false;
    let attemptCount = 0;

    await tenantDb.transaction(async (tx) => {
      assertValidSchemaName(destSchemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
      );
      const { outboundGateway } = buildTenantSchema(destSchemaName);

      const claimRes = await tx
        .update(outboundGateway)
        .set({
          status: "PROCESSING",
          attempts: sql`${outboundGateway.attempts} + 1`,
          updatedAt: sql`NOW()`,
        })
        .where(
          sql`${outboundGateway.id} = ${id}
            AND (
              ${outboundGateway.status} = 'PENDING'
              OR ${outboundGateway.status} = 'RETRY'
              OR (${outboundGateway.status} = 'PROCESSING'
                  AND ${outboundGateway.updatedAt} <= NOW() - INTERVAL '5 minutes')
            )`,
        )
        .returning({
          id: outboundGateway.id,
          attempts: outboundGateway.attempts,
        });

      if (claimRes.length > 0) {
        claimed = true;
        attemptCount = claimRes[0].attempts ?? 0;
      }
    });

    return { claimed, attemptCount };
  }

  async markResult(
    tenantId: string,
    destSchemaName: string,
    id: string,
    attemptCount: number,
    status: "SUCCESS" | "FAIL" | "RETRY",
    statusCode: number,
    response: Record<string, unknown> | null,
    sentPayload: Record<string, unknown> | null,
    destVendorId?: string,
    replicaUpdate?: {
      traceId: string;
      dataSourceId: string;
      targetObject: string;
    },
  ): Promise<void> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);

    await tenantDb.transaction(async (tx) => {
      assertValidSchemaName(destSchemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
      );

      const { outboundGateway, replicaEntity } =
        buildTenantSchema(destSchemaName);

      const updateResult = await tx
        .update(outboundGateway)
        .set({
          response: response ?? {},
          statusCode,
          status,
          ...(sentPayload && { payload: sentPayload }),
          ...(destVendorId && { destVendorId }),
        })
        .where(
          sql`${outboundGateway.id} = ${id} AND ${outboundGateway.attempts} = ${attemptCount}`,
        )
        .returning({ id: outboundGateway.id });

      if (updateResult.length === 0) {
        throw new Error(
          `Outbound gateway update failed: lost claim race for id=${id}, attempt=${attemptCount}`,
        );
      }

      if (status === "SUCCESS" && response && destVendorId && replicaUpdate) {
        await tx
          .insert(replicaEntity)
          .values({
            traceId: replicaUpdate.traceId,
            dataSourceId: replicaUpdate.dataSourceId,
            entityType: replicaUpdate.targetObject,
            entityId: destVendorId,
            data: response,
            version: 1,
          })
          .onConflictDoUpdate({
            target: [
              replicaEntity.dataSourceId,
              replicaEntity.entityType,
              replicaEntity.entityId,
            ],
            set: {
              data: response,
              traceId: replicaUpdate.traceId,
              version: sql`${replicaEntity.version} + 1`,
              updatedAt: sql`NOW()`,
            },
          });
      }
    });
  }
}

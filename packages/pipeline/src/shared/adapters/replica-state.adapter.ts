import { Injectable, Inject } from "@nestjs/common";
import { sql, eq, and } from "drizzle-orm";
import { buildTenantSchema, assertValidSchemaName } from "@soopa/database";
import { DB_MANAGER } from "@soopa/dbmanager";
import type { DatabaseManager } from "@soopa/dbmanager";
import type {
  IReplicaStatePort,
  InboundRecord,
  ExtractedReplica,
} from "../domain.js";

@Injectable()
export class ReplicaStateAdapter implements IReplicaStatePort {
  constructor(
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  async fetchInboundRecord(
    tenantId: string,
    schemaName: string,
    traceId: string,
  ): Promise<InboundRecord | null> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);

    return await tenantDb.transaction(async (tx) => {
      assertValidSchemaName(schemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );

      const { inboundGateway } = buildTenantSchema(schemaName);

      const rows = await tx
        .select()
        .from(inboundGateway)
        .where(sql`${inboundGateway.traceId} = ${traceId}`)
        .limit(1);

      if (rows.length === 0) return null;

      const inbound = rows[0];
      return {
        id: inbound.id,
        traceId: inbound.traceId,
        status: inbound.status,
        request: inbound.request as Record<string, unknown>,
      };
    });
  }

  async persistReplicaExtraction(
    tenantId: string,
    schemaName: string,
    dataSourceId: string,
    traceId: string,
    inboundRecordId: string,
    extracted: ExtractedReplica,
    durationMs: number,
  ): Promise<void> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);

    await tenantDb.transaction(async (tx) => {
      assertValidSchemaName(schemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );

      const {
        inboundGateway,
        replicaEntity,
        replicaOutbox,
        syncLog,
        activeSyncLocks,
      } = buildTenantSchema(schemaName);

      // ── ACQUIRE ENTITY LOCK ───────────────────────────────────────────────
      try {
        await tx
          .delete(activeSyncLocks)
          .where(
            and(
              eq(activeSyncLocks.dataSourceId, dataSourceId),
              eq(activeSyncLocks.entityId, extracted.entityId),
              sql`${activeSyncLocks.expiresAt} < NOW()`,
            ),
          );

        await tx.insert(activeSyncLocks).values({
          dataSourceId,
          entityId: extracted.entityId,
          lockedByTraceId: traceId,
          expiresAt: sql`NOW() + INTERVAL '10 minutes'`,
        });
      } catch (err: any) {
        const isUniqueViolation =
          err.code === "23505" ||
          (err.cause && err.cause.code === "23505") ||
          (err instanceof Error &&
            (err.message.includes("unique constraint") ||
              err.message.includes("duplicate key")));

        if (isUniqueViolation) {
          const lockContentionError = new Error(
            `Entity ${extracted.entityId} is currently locked by an in-flight sync. Delaying processing to maintain FIFO order.`,
          );
          Object.assign(lockContentionError, { isLockContention: true });
          throw lockContentionError;
        }
        throw err;
      }

      await tx
        .insert(replicaEntity)
        .values({
          traceId,
          dataSourceId,
          entityType: extracted.entityType,
          entityId: extracted.entityId,
          data: extracted.data,
          version: 1,
        })
        .onConflictDoUpdate({
          target: [
            replicaEntity.dataSourceId,
            replicaEntity.entityType,
            replicaEntity.entityId,
          ],
          set: {
            data: extracted.data,
            traceId,
            version: sql`${replicaEntity.version} + 1`,
            updatedAt: sql`NOW()`,
          },
        });

      await tx
        .update(inboundGateway)
        .set({ status: "REPLICATED" })
        .where(sql`${inboundGateway.id} = ${inboundRecordId}`);

      await tx
        .insert(syncLog)
        .values({
          traceId,
          layer: "L2",
          status: "SUCCESS",
          durationMs,
        })
        .onConflictDoNothing();

      await tx
        .insert(replicaOutbox)
        .values({
          traceId,
          dataSourceId,
          status: "PENDING",
        })
        .onConflictDoNothing({
          target: [replicaOutbox.traceId, replicaOutbox.dataSourceId],
        });
    });
  }

  async markInboundFail(
    tenantId: string,
    schemaName: string,
    traceId: string,
    errorMessage: string,
    durationMs: number,
  ): Promise<void> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);

    await tenantDb.transaction(async (tx) => {
      assertValidSchemaName(schemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );

      const { syncLog, inboundGateway } = buildTenantSchema(schemaName);

      await tx
        .insert(syncLog)
        .values({
          traceId,
          layer: "L2",
          status: "FAIL",
          durationMs,
          errorMessage,
        })
        .onConflictDoUpdate({
          target: [syncLog.traceId, syncLog.layer, syncLog.status],
          targetWhere: sql`${syncLog.routeId} IS NULL`,
          set: {
            errorMessage,
            durationMs,
          },
        });

      await tx
        .update(inboundGateway)
        .set({
          status: "FAIL",
          errorMessage,
        })
        .where(sql`${inboundGateway.traceId} = ${traceId}`);
    });
  }
}

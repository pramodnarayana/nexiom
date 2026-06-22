import { Injectable, Inject } from "@nestjs/common";
import { NORMALIZATION_REPOSITORY_PORT, type NormalizationRepositoryPort, type ReplicaRecord } from '../../ports/normalization.repository.port.js';
import { type TxContext } from '../../ports/transaction-manager.port.js';
import { DB_MANAGER, type TenantDatabaseManager } from "@soopa/dbmanager";
import { buildTenantSchema, assertValidSchemaName } from "@soopa/database";
import { sql } from "drizzle-orm";

@Injectable()
export class DrizzleNormalizationRepositoryAdapter implements NormalizationRepositoryPort {
  constructor(
    @Inject(DB_MANAGER) private readonly dbManager: TenantDatabaseManager
  ) {}

  async findReplicaByTraceId(
    schemaName: string,
    traceId: string,
    tx: TxContext
  ): Promise<ReplicaRecord | null> {
    assertValidSchemaName(schemaName);
    const { replicaEntity } = buildTenantSchema(schemaName);

    const rows = await tx
      .select()
      .from(replicaEntity)
      .where(sql`${replicaEntity.traceId} = ${traceId}`)
      .limit(1);

    if (rows[0]) {
      return rows[0] as unknown as ReplicaRecord;
    }
    return null;
  }

  async checkIfSuperseded(
    schemaName: string,
    dataSourceId: string,
    entityId: string,
    traceId: string,
    tx: TxContext
  ): Promise<boolean> {
    assertValidSchemaName(schemaName);
    const { replicaEntity } = buildTenantSchema(schemaName);

    const rows = await tx
      .select({ id: replicaEntity.id, traceId: replicaEntity.traceId })
      .from(replicaEntity)
      .where(
        sql`${replicaEntity.dataSourceId} = ${dataSourceId}
             AND ${replicaEntity.entityId} = ${entityId}
             AND ${replicaEntity.traceId} != ${traceId}`
      )
      .limit(1);

    return rows.length > 0;
  }

  async fetchInboundRequest(
    schemaName: string,
    traceId: string,
    tx: TxContext
  ): Promise<{ request: Record<string, unknown>; objectType?: string | null } | null> {
    assertValidSchemaName(schemaName);
    const { inboundGateway } = buildTenantSchema(schemaName);

    const rows = await tx
      .select({ request: inboundGateway.request, objectType: inboundGateway.objectType })
      .from(inboundGateway)
      .where(sql`${inboundGateway.traceId} = ${traceId}`)
      .limit(1);

    if (!rows[0]) return null;
    return {
      request: rows[0].request as Record<string, unknown>,
      objectType: rows[0].objectType,
    };
  }

  async upsertNormalizedEntity(
    schemaName: string,
    traceId: string,
    replicaId: string,
    canonicalType: string,
    safeData: Record<string, unknown>,
    tx: TxContext
  ): Promise<string> {
    assertValidSchemaName(schemaName);
    const { normalizedEntity } = buildTenantSchema(schemaName);

    const insertRes = await tx
      .insert(normalizedEntity)
      .values({
        traceId,
        replicaId,
        canonicalType,
        data: safeData,
      })
      .onConflictDoUpdate({
        target: normalizedEntity.replicaId,
        set: {
          traceId,
          canonicalType,
          data: safeData,
          updatedAt: sql`NOW()`,
        },
      })
      .returning({ id: normalizedEntity.id });

    return insertRes[0].id;
  }

  async insertNormalizedOutboxPending(
    schemaName: string,
    traceId: string,
    dataSourceId: string,
    tx: TxContext
  ): Promise<void> {
    assertValidSchemaName(schemaName);
    const { normalizedOutbox } = buildTenantSchema(schemaName);

    await tx
      .insert(normalizedOutbox)
      .values({
        traceId,
        dataSourceId,
        status: "PENDING",
      })
      .onConflictDoNothing({
        target: [normalizedOutbox.traceId, normalizedOutbox.dataSourceId],
      });
  }

  async markNormalizedOutboxSuccess(
    tenantId: string,
    schemaName: string,
    traceId: string,
    dataSourceId: string
  ): Promise<void> {
    assertValidSchemaName(schemaName);
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    const { normalizedOutbox } = buildTenantSchema(schemaName);

    await tenantDb
      .update(normalizedOutbox)
      .set({ status: "SUCCESS" })
      .where(
        sql`${normalizedOutbox.traceId} = ${traceId} AND ${normalizedOutbox.dataSourceId} = ${dataSourceId}`
      );
  }
}

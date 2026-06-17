import { Injectable, Inject } from "@nestjs/common";
import { sql, eq, and } from "drizzle-orm";
import { buildTenantSchema, assertValidSchemaName } from "@soopa/database";
import type { DrizzleDb } from "@soopa/database";
import { PipelineStateRepositoryPort } from '../../../shared/ports/pipeline-state.repository.port.js';
import { DB_MANAGER, type DatabaseManager } from "@soopa/dbmanager";

@Injectable()
export class DrizzlePipelineStateRepositoryAdapter implements PipelineStateRepositoryPort {
  constructor(
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  async getNormalizedData(traceId: string, schemaName: string, tx: any): Promise<{ data: Record<string, unknown>; canonicalType: string } | null> {
    const { normalizedEntity } = buildTenantSchema(schemaName);
    
    const normRows = await tx
      .select()
      .from(normalizedEntity)
      .where(sql`${normalizedEntity.traceId} = ${traceId}`)
      .limit(1);

    if (normRows.length === 0) {
      return null;
    }

    return {
      data: normRows[0].data as Record<string, unknown>,
      canonicalType: normRows[0].canonicalType ?? "RAW",
    };
  }

  async getReplicaSourceVendorId(traceId: string, schemaName: string, tx: any): Promise<string | null> {
    const { replicaEntity } = buildTenantSchema(schemaName);

    const replicaRows = await tx
      .select({ entityId: replicaEntity.entityId })
      .from(replicaEntity)
      .where(sql`${replicaEntity.traceId} = ${traceId}`)
      .limit(1);

    if (replicaRows.length === 0) {
      return null;
    }

    return replicaRows[0].entityId ?? null;
  }

  async releaseSyncLock(dataSourceId: string, entityId: string, schemaName: string, tenantId: string): Promise<void> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    
    await tenantDb.transaction(async (tx) => {
      assertValidSchemaName(schemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );
      const { activeSyncLocks } = buildTenantSchema(schemaName);
      await tx
        .delete(activeSyncLocks)
        .where(
          and(
            eq(activeSyncLocks.dataSourceId, dataSourceId),
            eq(activeSyncLocks.entityId, entityId),
          ),
        );
    });
  }

  async releaseSyncLockByTraceId(tenantId: string, schemaName: string, traceId: string, tx?: any): Promise<void> {
    const doDelete = async (transaction: any) => {
      const { activeSyncLocks } = buildTenantSchema(schemaName);
      await transaction
        .delete(activeSyncLocks)
        .where(eq(activeSyncLocks.lockedByTraceId, traceId));
    };

    if (tx) {
      await doDelete(tx);
    } else {
      const tenantDb = await this.dbManager.getTenantDb(tenantId);
      await tenantDb.transaction(async (transaction) => {
        assertValidSchemaName(schemaName);
        await transaction.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
        );
        await doDelete(transaction);
      });
    }
  }

  async getDestinationEntityState(
    tenantId: string,
    targetSchemaName: string,
    destDataSourceId: string,
    targetObject: string,
    destEntityId: string
  ): Promise<Record<string, unknown> | null> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    const { replicaEntity: targetReplicaEntity } = buildTenantSchema(targetSchemaName);

    const targetReplica = await tenantDb
      .select()
      .from(targetReplicaEntity)
      .where(
        sql`${targetReplicaEntity.dataSourceId} = ${destDataSourceId} AND ${targetReplicaEntity.entityType} = ${targetObject} AND ${targetReplicaEntity.entityId} = ${destEntityId}`,
      )
      .limit(1);

    if (targetReplica.length > 0) {
      return targetReplica[0].data as Record<string, unknown>;
    }

    return null;
  }
}

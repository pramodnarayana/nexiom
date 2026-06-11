import { Injectable, Inject } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DATABASE_CONNECTION, buildTenantSchema } from "@soopa/database";
import type { DrizzleDb } from "@soopa/database";
import { RoutingRepositoryPort } from "../../shared/ports/routing.repository.port.js";

type DbTransaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

@Injectable()
export class DrizzleRoutingRepositoryAdapter implements RoutingRepositoryPort {
  constructor(@Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb) {}

  private getExecutor(tx?: any): DbTransaction | DrizzleDb {
    return tx || this.globalDb;
  }

  async hasNormalizedRecord(traceId: string, schemaName: string, tx?: any): Promise<boolean> {
    const { normalizedEntity } = buildTenantSchema(schemaName);
    const executor = this.getExecutor(tx);

    const normRows = await executor
      .select({ id: normalizedEntity.id })
      .from(normalizedEntity)
      .where(sql`${normalizedEntity.traceId} = ${traceId}`)
      .limit(1);

    return normRows.length > 0;
  }

  async getReplicaIdByTraceId(traceId: string, schemaName: string, tx?: any): Promise<string | null> {
    const { replicaEntity } = buildTenantSchema(schemaName);
    const executor = this.getExecutor(tx);

    const replicaRows = await executor
      .select({ replicaId: replicaEntity.id })
      .from(replicaEntity)
      .where(sql`${replicaEntity.traceId} = ${traceId}`)
      .limit(1);

    return replicaRows.length > 0 ? replicaRows[0].replicaId : null;
  }

  async hasSupersedingNormalizedRecord(replicaId: string, excludeTraceId: string, schemaName: string, tx?: any): Promise<boolean> {
    const { normalizedEntity } = buildTenantSchema(schemaName);
    const executor = this.getExecutor(tx);

    const anyNorm = await executor
      .select({ traceId: normalizedEntity.traceId })
      .from(normalizedEntity)
      .where(
        sql`${normalizedEntity.replicaId} = ${replicaId} AND ${normalizedEntity.traceId} != ${excludeTraceId}`,
      )
      .limit(1);

    return anyNorm.length > 0;
  }
}

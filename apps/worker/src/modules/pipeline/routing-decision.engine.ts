import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { DrizzleDb, buildTenantSchema } from "@soopa/database";

type NormalizedEntity = ReturnType<
  typeof buildTenantSchema
>["normalizedEntity"];
type ReplicaEntity = ReturnType<typeof buildTenantSchema>["replicaEntity"];
type DbTransaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

@Injectable()
export class RoutingDecisionEngine {
  /**
   * Evaluates whether a given traceId has been superseded by a newer trace
   * for the same replica entity.
   */
  async evaluateSuperseded(
    tx: DbTransaction,
    normalizedEntity: NormalizedEntity,
    replicaEntity: ReplicaEntity,
    traceId: string,
  ): Promise<{ kind: "found" } | { kind: "superseded" }> {
    const normRows = await tx
      .select()
      .from(normalizedEntity)
      .where(sql`${normalizedEntity.traceId} = ${traceId}`)
      .limit(1);

    if (!normRows.length) {
      const replicaRows = await tx
        .select({ replicaId: replicaEntity.id })
        .from(replicaEntity)
        .where(sql`${replicaEntity.traceId} = ${traceId}`)
        .limit(1);

      if (replicaRows.length > 0) {
        const replicaId = replicaRows[0].replicaId;
        const anyNorm = await tx
          .select({ traceId: normalizedEntity.traceId })
          .from(normalizedEntity)
          .where(
            sql`${normalizedEntity.replicaId} = ${replicaId} AND ${normalizedEntity.traceId} != ${traceId}`,
          )
          .limit(1);

        if (anyNorm.length > 0) {
          return { kind: "superseded" as const };
        }
      }

      throw new Error(
        `Normalized record for traceId ${traceId} not found and no superseding record exists. ` +
          `L3 may not have committed. The message will be retried.`,
      );
    }

    return { kind: "found" };
  }
}

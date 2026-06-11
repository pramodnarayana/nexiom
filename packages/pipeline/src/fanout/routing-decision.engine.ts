import { Injectable, Inject } from "@nestjs/common";
import { ROUTING_REPOSITORY_PORT, RoutingRepositoryPort } from "../shared/ports/routing.repository.port.js";

@Injectable()
export class RoutingDecisionEngine {
  constructor(
    @Inject(ROUTING_REPOSITORY_PORT)
    private readonly routingRepo: RoutingRepositoryPort
  ) {}

  /**
   * Evaluates whether a given traceId has been superseded by a newer trace
   * for the same replica entity.
   */
  async evaluateSuperseded(
    traceId: string,
    schemaName: string,
    tx?: any
  ): Promise<{ kind: "found" } | { kind: "superseded" }> {
    const hasNormalized = await this.routingRepo.hasNormalizedRecord(traceId, schemaName, tx);

    if (!hasNormalized) {
      const replicaId = await this.routingRepo.getReplicaIdByTraceId(traceId, schemaName, tx);

      if (replicaId) {
        const hasSuperseding = await this.routingRepo.hasSupersedingNormalizedRecord(replicaId, traceId, schemaName, tx);

        if (hasSuperseding) {
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

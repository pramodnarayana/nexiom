import { NormalizationRepositoryPort, ReplicaRecord } from "../ports/normalization.repository.port.js";
import { TxContext } from "../ports/transaction-manager.port.js";

export class FakeNormalizationRepository implements NormalizationRepositoryPort {
  public replicas: ReplicaRecord[] = [];
  public inboundRequests: { schemaName: string; traceId: string; payload: any }[] = [];
  public normalizedEntities: { schemaName: string; traceId: string; replicaId: string; canonicalType: string; safeData: any }[] = [];
  public normalizedOutbox: { schemaName: string; traceId: string; dataSourceId: string; status: string }[] = [];
  public supersededChecks: { traceId: string; isSuperseded: boolean }[] = [];

  async findReplicaByTraceId(schemaName: string, traceId: string, tx: TxContext): Promise<ReplicaRecord | null> {
    return this.replicas.find(r => r.traceId === traceId) || null;
  }

  async checkIfSuperseded(schemaName: string, dataSourceId: string, entityId: string, traceId: string, tx: TxContext): Promise<boolean> {
    const check = this.supersededChecks.find(c => c.traceId === traceId);
    return check ? check.isSuperseded : false;
  }

  async fetchInboundRequest(schemaName: string, traceId: string, tx: TxContext): Promise<Record<string, unknown> | null> {
    const req = this.inboundRequests.find(r => r.schemaName === schemaName && r.traceId === traceId);
    return req ? req.payload : null;
  }

  async upsertNormalizedEntity(schemaName: string, traceId: string, replicaId: string, canonicalType: string, safeData: Record<string, unknown>, tx: TxContext): Promise<string> {
    const existingIndex = this.normalizedEntities.findIndex(e => e.traceId === traceId);
    if (existingIndex > -1) {
      this.normalizedEntities[existingIndex] = { schemaName, traceId, replicaId, canonicalType, safeData };
    } else {
      this.normalizedEntities.push({ schemaName, traceId, replicaId, canonicalType, safeData });
    }
    return "norm-id-123";
  }

  async insertNormalizedOutboxPending(schemaName: string, traceId: string, dataSourceId: string, tx: TxContext): Promise<void> {
    const existing = this.normalizedOutbox.find(o => o.traceId === traceId && o.dataSourceId === dataSourceId);
    if (!existing) {
      this.normalizedOutbox.push({ schemaName, traceId, dataSourceId, status: "PENDING" });
    }
  }

  async markNormalizedOutboxSuccess(tenantId: string, schemaName: string, traceId: string, dataSourceId: string): Promise<void> {
    const existing = this.normalizedOutbox.find(o => o.traceId === traceId && o.dataSourceId === dataSourceId);
    if (existing) {
      existing.status = "SUCCESS";
    }
  }
}

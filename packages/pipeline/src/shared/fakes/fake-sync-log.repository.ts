import { SyncLogRepositoryPort } from "../ports/sync-log.repository.port.js";

export class FakeSyncLogRepository implements SyncLogRepositoryPort {
  public logs: { tenantId: string; schemaName: string; traceId: string; routeId: string | null; layer: string; status: string; durationMs: number; errorMessage?: string }[] = [];

  async writeSyncLog(tenantId: string, schemaName: string, traceId: string, routeId: string | null, layer: "L3" | "L4" | "L5" | "L6", status: "PROCESSING" | "SUCCESS" | "FAIL" | "SKIPPED", durationMs: number, errorMessage?: string, tx?: any): Promise<void> {
    this.logs.push({ tenantId, schemaName, traceId, routeId, layer, status, durationMs, errorMessage });
  }

  async hasCompletedSyncLog(tenantId: string, schemaName: string, traceId: string, routeId: string, layer: string): Promise<boolean> {
    return this.logs.some(l => l.tenantId === tenantId && l.schemaName === schemaName && l.traceId === traceId && l.routeId === routeId && l.layer === layer && (l.status === "SUCCESS" || l.status === "FAIL"));
  }
}

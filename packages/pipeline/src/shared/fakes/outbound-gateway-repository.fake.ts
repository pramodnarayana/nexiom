import type { OutboundGatewayRepositoryPort } from '../ports/outbound-gateway.repository.port.js';

export class FakeOutboundGatewayRepository implements OutboundGatewayRepositoryPort {
  public data = new Map<string, any>();

  async upsertPendingOutboundGateway(
    tenantId: string,
    destSchemaName: string,
    traceId: string,
    routeId: string,
    destDataSourceId: string,
    sourceDataSourceId: string,
    payload: Record<string, unknown>
  ): Promise<boolean> {
    const key = `${tenantId}_${destSchemaName}_${traceId}_${routeId}`;
    if (!this.data.has(key)) {
      this.data.set(key, { status: 'PENDING', payload });
      return true;
    }
    return false;
  }

  async upsertDeferredOutboundGateway(
    tenantId: string,
    destSchemaName: string,
    traceId: string,
    routeId: string,
    destDataSourceId: string,
    sourceDataSourceId: string
  ): Promise<boolean> {
    const key = `${tenantId}_${destSchemaName}_${traceId}_${routeId}`;
    this.data.set(key, { status: 'DEFERRED_DEPENDENCY' });
    return true;
  }

  async markOutboundGatewayFailed(
    tenantId: string,
    destSchemaName: string,
    traceId: string,
    routeId: string
  ): Promise<void> {
    const key = `${tenantId}_${destSchemaName}_${traceId}_${routeId}`;
    const rec = this.data.get(key) || {};
    rec.status = 'FAIL';
    this.data.set(key, rec);
  }

  async insertOrFetchPending(
    tenantId: string,
    destSchemaName: string,
    data: {
      traceId: string;
      routeId: string;
      dataSourceId: string;
      srcDataSourceId: string;
      payload: Record<string, unknown>;
    }
  ): Promise<{ id: string; status: string; attempts: number }> {
    const key = `${tenantId}_${destSchemaName}_${data.traceId}_${data.routeId}`;
    if (this.data.has(key)) {
      const existing = this.data.get(key);
      return { id: existing.id || key, status: existing.status, attempts: existing.attempts || 1 };
    }
    
    this.data.set(key, { id: key, status: 'PENDING', attempts: 1, ...data });
    return { id: key, status: 'PENDING', attempts: 1 };
  }

  async claimForProcessing(
    tenantId: string,
    destSchemaName: string,
    id: string
  ): Promise<{ claimed: boolean; attemptCount: number }> {
    // for simplicity, search by id
    const rec = Array.from(this.data.values()).find(v => v.id === id);
    if (!rec || rec.status !== 'PENDING') {
      return { claimed: false, attemptCount: 1 };
    }
    rec.status = 'PROCESSING';
    rec.attempts = (rec.attempts || 0) + 1;
    return { claimed: true, attemptCount: rec.attempts };
  }

  async markResult(
    tenantId: string,
    destSchemaName: string,
    outboundGatewayId: string,
    attemptCount: number,
    status: "SUCCESS" | "FAIL" | "RETRY",
    statusCode: number,
    responsePayload: Record<string, unknown> | null,
    sentPayload: Record<string, unknown> | null,
    destVendorId?: string,
    replicaUpdate?: any
  ): Promise<void> {
    const rec = Array.from(this.data.values()).find(v => v.id === outboundGatewayId);
    if (rec) {
      rec.status = status;
      rec.statusCode = statusCode;
      rec.responsePayload = responsePayload;
      rec.sentPayload = sentPayload;
      rec.destVendorId = destVendorId;
    } else {
      this.data.set(outboundGatewayId, {
        id: outboundGatewayId,
        status,
        statusCode,
        responsePayload,
        sentPayload,
        destVendorId
      });
    }
  }

  async fetchOutboundGatewayResult(
    tenantId: string,
    destSchemaName: string,
    outboundGatewayId: string
  ): Promise<any> {
    const rec = Array.from(this.data.values()).find(v => v.id === outboundGatewayId);
    if (!rec) return null;
    return {
      attempts: rec.attempts || 1,
      statusCode: rec.statusCode || null,
      response: rec.responsePayload || null,
      destVendorId: rec.destVendorId || null,
    };
  }
}

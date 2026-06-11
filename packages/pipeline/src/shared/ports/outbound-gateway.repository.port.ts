export interface OutboundGatewayRepositoryPort {
  /**
   * Upserts an outbound gateway record with PENDING status.
   * Returns true if a new record was inserted or an existing retryable record was updated.
   */
  upsertPendingOutboundGateway(
    tenantId: string,
    destSchemaName: string,
    traceId: string,
    routeId: string,
    destDataSourceId: string,
    sourceDataSourceId: string,
    payload: Record<string, unknown>
  ): Promise<boolean>;

  /**
   * Upserts an outbound gateway record with DEFERRED_DEPENDENCY status.
   * Returns true if a new record was inserted or an existing record transitioned to this state.
   */
  upsertDeferredOutboundGateway(
    tenantId: string,
    destSchemaName: string,
    traceId: string,
    routeId: string,
    destDataSourceId: string,
    sourceDataSourceId: string
  ): Promise<boolean>;

  /**
   * Updates an existing outbound gateway record to FAILED status.
   */
  markOutboundGatewayFailed(
    tenantId: string,
    destSchemaName: string,
    traceId: string,
    routeId: string
  ): Promise<void>;

  /**
   * Inserts a new PENDING outbound gateway record or fetches an existing one.
   * Returns the ID, status, and attempt count.
   */
  insertOrFetchPending(
    tenantId: string,
    destSchemaName: string,
    data: {
      traceId: string;
      routeId: string;
      dataSourceId: string;
      srcDataSourceId: string;
      payload: Record<string, unknown>;
    }
  ): Promise<{ id: string; status: string; attempts: number }>;

  /**
   * Attempts to claim an outbound gateway record for processing.
   * Returns true if successfully claimed, and the current attempt count.
   */
  claimForProcessing(
    tenantId: string,
    destSchemaName: string,
    id: string
  ): Promise<{ claimed: boolean; attemptCount: number }>;

  /**
   * Marks the final result of an outbound delivery attempt.
   */
  markResult(
    tenantId: string,
    destSchemaName: string,
    outboundGatewayId: string,
    attemptCount: number,
    status: "SUCCESS" | "FAIL" | "RETRY",
    statusCode: number,
    responsePayload: Record<string, unknown> | null,
    sentPayload: Record<string, unknown> | null,
    destVendorId?: string,
    replicaUpdate?: {
      traceId: string;
      dataSourceId: string;
      targetObject: string;
    }
  ): Promise<void>;

  /**
   * Fetches the result of a specific outbound gateway delivery.
   */
  fetchOutboundGatewayResult(
    tenantId: string,
    destSchemaName: string,
    outboundGatewayId: string
  ): Promise<{
    attempts: number;
    statusCode: number | null;
    response: Record<string, unknown> | null;
    destVendorId: string | null;
  } | null>;
}

export const OUTBOUND_GATEWAY_REPOSITORY_PORT = Symbol('OUTBOUND_GATEWAY_REPOSITORY_PORT');

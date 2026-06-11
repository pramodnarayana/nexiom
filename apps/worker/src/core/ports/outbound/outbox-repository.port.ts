export interface OutboxRow<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  attempts: number;
  claimToken?: string | null;
  traceId?: string;
  dataSourceId?: string;
  payload: unknown;
  extra?: T;
}

export interface OutboxRepositoryPort {
  claimNextBatch(
    tenantId: string,
    schemaName: string,
    batchSize: number,
  ): Promise<OutboxRow[]>;

  markSuccess(
    tenantId: string,
    schemaName: string,
    rowId: string,
    claimToken?: string | null,
  ): Promise<void>;

  markRetry(
    tenantId: string,
    schemaName: string,
    rowId: string,
    attempts: number,
    errorMessage: string,
    nextRetryAt: Date,
    claimToken?: string | null,
  ): Promise<void>;

  markFailed(
    tenantId: string,
    schemaName: string,
    rowId: string,
    errorMessage: string,
    claimToken?: string | null,
  ): Promise<void>;
}

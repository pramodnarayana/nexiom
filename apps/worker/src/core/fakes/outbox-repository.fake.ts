/* eslint-disable @typescript-eslint/require-await */
import type {
  OutboxRepositoryPort,
  OutboxRow,
} from "../ports/outbound/outbox-repository.port.js";

export class FakeOutboxRepository implements OutboxRepositoryPort {
  public rows: OutboxRow[] = [];
  public statuses = new Map<string, string>();
  public retries = new Map<string, number>();
  public shouldFailMarkSuccess = false;
  public shouldFailMarkFailure = false;

  async claimNextBatch(
    _tenantId: string,
    _schemaName: string,
    batchSize: number,
  ): Promise<OutboxRow[]> {
    const pending = this.rows.filter((r) => {
      const status = this.statuses.get(r.id);
      // Only claim rows that are in a claimable state.
      // RETRY rows are gated behind retry_at in production; exclude them here
      // to prevent the while(true) loop from re-claiming the same row forever.
      return status === "PENDING" || status === undefined;
    });
    const toClaim = pending.slice(0, batchSize);
    for (const row of toClaim) {
      this.statuses.set(row.id, "PROCESSING");
      row.claimToken = "fake-token";
    }
    return toClaim;
  }

  async markSuccess(
    _tenantId: string,
    _schemaName: string,
    rowId: string,
    __claimToken?: string | null,
  ): Promise<void> {
    if (this.shouldFailMarkSuccess) throw new Error("DB Error");
    this.statuses.set(rowId, "SUCCESS");
  }

  async markRetry(
    _tenantId: string,
    _schemaName: string,
    rowId: string,
    attempts: number,
    _errorMessage: string,
    __nextRetryAt: Date,
    __claimToken?: string | null,
  ): Promise<void> {
    if (this.shouldFailMarkFailure) throw new Error("DB Error");
    this.statuses.set(rowId, "RETRY");
    this.retries.set(rowId, attempts);
  }

  async markFailed(
    _tenantId: string,
    _schemaName: string,
    rowId: string,
    _errorMessage: string,
    __claimToken?: string | null,
  ): Promise<void> {
    if (this.shouldFailMarkFailure) throw new Error("DB Error");
    this.statuses.set(rowId, "FAIL");
  }

  // Test helpers
  addRows(rows: OutboxRow[]) {
    this.rows.push(...rows);
    for (const r of rows) {
      if (!this.statuses.has(r.id)) {
        this.statuses.set(r.id, "PENDING");
      }
    }
  }
}

export const ITriggerDlqService = Symbol('ITriggerDlqService');

export interface ITriggerDlqService {
  pushJob(jobPayload: string): Promise<void>;
  promoteDelayedJobs(batchSize: number): Promise<number>;
  reclaimStaleJobs(staleMs: number, batchSize: number): Promise<number>;

  /**
   * Fetches ready jobs in batch. Returns raw string payloads.
   */
  drainReadyJobs(
    batchSize: number,
    handler: (raw: string) => Promise<void>,
  ): Promise<void>;

  scheduleDelayedRetry(
    raw: string,
    retryPayload: string,
    delayMs: number,
  ): Promise<void>;
  markJobFailed(raw: string, failedPayload: string): Promise<void>;
  acknowledgeJob(raw: string): Promise<void>;
  removeUnparseableJob(raw: string): Promise<void>;
}

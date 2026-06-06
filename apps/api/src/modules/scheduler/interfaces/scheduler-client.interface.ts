export const ISchedulerClient = Symbol('ISchedulerClient');

export interface ISchedulerClient {
  /**
   * Ensures the necessary execution script exists in the scheduler workspace.
   * Idempotent — safe to call on every bootstrap.
   */
  ensureConnectionScript(): Promise<void>;

  /**
   * Creates a new schedule for the given connection.
   * Throws if the schedule already exists (use updateSchedule to modify).
   */
  createSchedule(
    connectionId: string,
    cron: string,
    enabled: boolean,
  ): Promise<void>;

  /**
   * Updates the cron expression and enabled state of an existing schedule.
   * Returns true if the schedule was updated, false if it did not exist.
   * Throws on any other error.
   */
  updateSchedule(
    connectionId: string,
    cron: string,
    enabled: boolean,
  ): Promise<boolean>;

  /**
   * Enables or disables an existing schedule without changing the cron expression.
   */
  setScheduleEnabled(connectionId: string, enabled: boolean): Promise<void>;

  /**
   * Returns true if a schedule exists for the given connection.
   */
  scheduleExists(connectionId: string): Promise<boolean>;

  /**
   * Deletes the schedule for the given connection.
   * No-op if the schedule does not exist.
   */
  deleteSchedule(connectionId: string): Promise<void>;

  /**
   * Triggers an immediate one-off run.
   * Returns the job ID.
   */
  triggerOnce(connectionId: string): Promise<string>;
}

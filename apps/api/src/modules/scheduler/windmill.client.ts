const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Windmill schedule path for a given connection.
 * All connection schedules live under f/connections/ in the nexiom workspace.
 * Validates that connectionId is a UUID to prevent path traversal in the Windmill API URL.
 */
export function schedulePathFor(connectionId: string): string {
  if (!UUID_RE.test(connectionId)) {
    throw new Error(
      `Invalid connectionId: expected a UUID, got "${connectionId.slice(0, 50)}"`,
    );
  }
  return `f/connections/${connectionId}`;
}

/** Windmill script path for the shared connection-runner. */
export const CONNECTION_RUNNER_PATH = 'f/connection-runner/main';

/**
 * Abstract WindmillClient.
 *
 * Implementations:
 *   - HttpWindmillClient  — calls the live Windmill REST API
 *   - StubWindmillClient  — in-memory no-op used when WINDMILL_ENABLED=false
 *
 * All schedule paths use the `f/connections/{connectionId}` convention.
 * The shared script lives at `f/connection-runner/main` and accepts { connectionId }.
 */
export abstract class WindmillClient {
  /**
   * Ensures the shared connection-runner Deno script exists in the Windmill workspace.
   * Idempotent — safe to call on every bootstrap.
   */
  abstract ensureConnectionScript(): Promise<void>;

  /**
   * Creates a new schedule for the given connection.
   * Throws if the schedule already exists (use updateSchedule to modify).
   */
  abstract createSchedule(
    connectionId: string,
    cron: string,
    enabled: boolean,
  ): Promise<void>;

  /**
   * Updates the cron expression and enabled state of an existing schedule.
   * Returns true if the schedule was updated, false if it did not exist (404).
   * Throws on any other error.
   */
  abstract updateSchedule(
    connectionId: string,
    cron: string,
    enabled: boolean,
  ): Promise<boolean>;

  /**
   * Enables or disables an existing schedule without changing the cron expression.
   */
  abstract setScheduleEnabled(
    connectionId: string,
    enabled: boolean,
  ): Promise<void>;

  /**
   * Returns true if a schedule exists for the given connection.
   */
  abstract scheduleExists(connectionId: string): Promise<boolean>;

  /**
   * Deletes the schedule for the given connection.
   * No-op if the schedule does not exist.
   */
  abstract deleteSchedule(connectionId: string): Promise<void>;

  /**
   * Triggers an immediate one-off run of the connection-runner script.
   * Returns the Windmill job ID.
   */
  abstract triggerOnce(connectionId: string): Promise<string>;
}

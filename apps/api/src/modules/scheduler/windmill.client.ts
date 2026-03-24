const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Windmill schedule path for a given stitch.
 * All stitch schedules live under f/stitches/ in the nexiom workspace.
 * Validates that stitchId is a UUID to prevent path traversal in the Windmill API URL.
 */
export function schedulePathFor(stitchId: string): string {
  if (!UUID_RE.test(stitchId)) {
    throw new Error(
      `Invalid stitchId: expected a UUID, got "${stitchId.slice(0, 50)}"`,
    );
  }
  return `f/stitches/${stitchId}`;
}

/** Windmill script path for the shared stitch-runner. */
export const STITCH_RUNNER_PATH = 'f/stitch-runner/main';

/**
 * Abstract WindmillClient.
 *
 * Implementations:
 *   - HttpWindmillClient  — calls the live Windmill REST API
 *   - StubWindmillClient  — in-memory no-op used when WINDMILL_ENABLED=false
 *
 * All schedule paths use the `f/stitches/{stitchId}` convention.
 * The shared script lives at `f/stitch-runner/main` and accepts { stitchId }.
 */
export abstract class WindmillClient {
  /**
   * Ensures the shared stitch-runner Deno script exists in the Windmill workspace.
   * Idempotent — safe to call on every bootstrap.
   */
  abstract ensureStitchScript(): Promise<void>;

  /**
   * Creates a new schedule for the given stitch.
   * Throws if the schedule already exists (use updateSchedule to modify).
   */
  abstract createSchedule(
    stitchId: string,
    cron: string,
    enabled: boolean,
  ): Promise<void>;

  /**
   * Updates the cron expression and enabled state of an existing schedule.
   * Returns true if the schedule was updated, false if it did not exist (404).
   * Throws on any other error.
   */
  abstract updateSchedule(
    stitchId: string,
    cron: string,
    enabled: boolean,
  ): Promise<boolean>;

  /**
   * Enables or disables an existing schedule without changing the cron expression.
   */
  abstract setScheduleEnabled(
    stitchId: string,
    enabled: boolean,
  ): Promise<void>;

  /**
   * Returns true if a schedule exists for the given stitch.
   */
  abstract scheduleExists(stitchId: string): Promise<boolean>;

  /**
   * Deletes the schedule for the given stitch.
   * No-op if the schedule does not exist.
   */
  abstract deleteSchedule(stitchId: string): Promise<void>;

  /**
   * Triggers an immediate one-off run of the stitch-runner script.
   * Returns the Windmill job ID.
   */
  abstract triggerOnce(stitchId: string): Promise<string>;
}

import type { SyncIntervalMinutes } from '@soopa/database';

/**
 * Maps a syncIntervalMinutes value to a 6-field Quartz/Windmill cron expression.
 * Field order: seconds minutes hours day-of-month month day-of-week
 *
 * Windmill's scheduler is built on the Rust `cron` crate which supports both
 * 5-field POSIX cron and 6-field Quartz-style cron (with a leading seconds
 * field).  The 6-field format is used here to allow second-level precision;
 * all expressions pin the seconds field to 0 so runs trigger at the top of
 * each interval boundary, matching POSIX semantics.
 *
 * 30m  -> every-30-minutes, 60m -> hourly, 120m -> every-2h, ..., 1440m -> daily midnight.
 */
export function intervalToCron(minutes: SyncIntervalMinutes): string {
  switch (minutes) {
    case 30:
      return '0 0/30 * * * *';
    case 60:
      return '0 0 * * * *';
    case 120:
      return '0 0 */2 * * *';
    case 240:
      return '0 0 */4 * * *';
    case 360:
      return '0 0 */6 * * *';
    case 720:
      return '0 0 */12 * * *';
    case 1440:
      return '0 0 0 * * *';
    default:
      throw new Error(
        `Unsupported sync interval: ${String(minutes)} minutes. Add it to intervalToCron and SYNC_INTERVAL_OPTIONS.`,
      );
  }
}

import type { SyncIntervalMinutes } from '@nexiom/database';

/**
 * Maps a syncIntervalMinutes value to a 6-field Quartz/Windmill cron expression.
 * Field order: seconds minutes hours day-of-month month day-of-week
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

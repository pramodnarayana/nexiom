import { describe, it, expect } from 'vitest';
import { intervalToCron } from './interval-to-cron.js';
import {
  SYNC_INTERVAL_OPTIONS,
  type SyncIntervalMinutes,
} from '@nexiom/database';

describe('intervalToCron', () => {
  it('maps 30 minutes to every-30-minutes cron', () => {
    expect(intervalToCron(30)).toBe('0 0/30 * * * *');
  });

  it('maps 60 minutes to every-hour cron', () => {
    expect(intervalToCron(60)).toBe('0 0 * * * *');
  });

  it('maps 120 minutes to every-2-hours cron', () => {
    expect(intervalToCron(120)).toBe('0 0 */2 * * *');
  });

  it('maps 240 minutes to every-4-hours cron', () => {
    expect(intervalToCron(240)).toBe('0 0 */4 * * *');
  });

  it('maps 360 minutes to every-6-hours cron', () => {
    expect(intervalToCron(360)).toBe('0 0 */6 * * *');
  });

  it('maps 720 minutes to every-12-hours cron', () => {
    expect(intervalToCron(720)).toBe('0 0 */12 * * *');
  });

  it('maps 1440 minutes to daily-at-midnight cron', () => {
    expect(intervalToCron(1440)).toBe('0 0 0 * * *');
  });

  it('throws for an unsupported interval value cast via `as`', () => {
    expect(() => intervalToCron(999 as SyncIntervalMinutes)).toThrow(
      'Unsupported sync interval: 999 minutes',
    );
  });

  it('throws for 0', () => {
    expect(() => intervalToCron(0 as SyncIntervalMinutes)).toThrow(
      'Unsupported sync interval: 0 minutes',
    );
  });

  it('throws for a negative value', () => {
    expect(() => intervalToCron(-60 as SyncIntervalMinutes)).toThrow(
      'Unsupported sync interval: -60 minutes',
    );
  });

  it('throws for NaN', () => {
    expect(() => intervalToCron(NaN as SyncIntervalMinutes)).toThrow(
      'Unsupported sync interval',
    );
  });

  it('covers all SYNC_INTERVAL_OPTIONS', () => {
    // Ensures intervalToCron has a branch for every valid interval —
    // if a new option is added to SYNC_INTERVAL_OPTIONS without updating
    // intervalToCron, this test will catch the gap via TypeScript exhaustiveness.
    for (const minutes of SYNC_INTERVAL_OPTIONS) {
      expect(() => intervalToCron(minutes)).not.toThrow();
      expect(intervalToCron(minutes)).toMatch(/^[\d*/,\- ]+$/);
    }
  });

  it('returns 6-field cron expressions for all options', () => {
    for (const minutes of SYNC_INTERVAL_OPTIONS) {
      const fields = intervalToCron(minutes).split(' ');
      expect(fields).toHaveLength(6);
    }
  });
});

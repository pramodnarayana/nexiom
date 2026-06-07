import { describe, it, expect } from 'vitest';
import {
  computeCursorStaleness,
  type CursorRow,
  type ConnectionMeta,
} from './cursor-staleness.js';

describe('computeCursorStaleness', () => {
  const now = 1000000;
  const createdAt = new Date(now - 86400000);

  const makeRow = (updatedAt: Date): CursorRow => ({
    id: 'c1',
    dataSourceId: 'ds1',
    streamName: 's1',
    createdAt,
    updatedAt,
  });

  it('marks as stale when age is strictly greater than 2x interval', () => {
    // 5 min interval => 10 min threshold (600,000 ms)
    const meta: ConnectionMeta = {
      syncIntervalMinutes: 5,
      scheduleEnabled: true,
    };
    // 10 minutes and 1 ms ago
    const row = makeRow(new Date(now - 600001));

    const result = computeCursorStaleness([row], meta, now);

    expect(result[0]).toEqual(
      expect.objectContaining({
        ageMs: 600001,
        paused: false,
        stale: true,
      }),
    );
  });

  it('marks as NOT stale when age is exactly 2x interval', () => {
    const meta: ConnectionMeta = {
      syncIntervalMinutes: 5,
      scheduleEnabled: true,
    };
    const row = makeRow(new Date(now - 600000));

    const result = computeCursorStaleness([row], meta, now);

    expect(result[0]).toEqual(
      expect.objectContaining({
        ageMs: 600000,
        paused: false,
        stale: false,
      }),
    );
  });

  it('marks as NOT stale when paused, regardless of age', () => {
    const meta: ConnectionMeta = {
      syncIntervalMinutes: 5,
      scheduleEnabled: false,
    };
    const row = makeRow(new Date(now - 600001));

    const result = computeCursorStaleness([row], meta, now);

    expect(result[0]).toEqual(
      expect.objectContaining({
        ageMs: 600001,
        paused: true,
        stale: false,
      }),
    );
  });

  it('marks as NOT stale when syncIntervalMinutes is 0 (manual)', () => {
    const meta: ConnectionMeta = {
      syncIntervalMinutes: 0,
      scheduleEnabled: true,
    };
    // 10 years ago
    const row = makeRow(new Date(now - 10 * 365 * 86400 * 1000));

    const result = computeCursorStaleness([row], meta, now);

    expect(result[0]).toEqual(
      expect.objectContaining({
        paused: false,
        stale: false,
      }),
    );
  });

  it('does NOT include stateDocument or extra fields in output', () => {
    const meta: ConnectionMeta = {
      syncIntervalMinutes: 5,
      scheduleEnabled: true,
    };
    const rowWithExtra = {
      ...makeRow(new Date(now)),
      stateDocument: { secretToken: '123' },
      internalFlags: 42,
    };

    const result = computeCursorStaleness(
      [rowWithExtra as CursorRow],
      meta,
      now,
    );

    expect(result[0]).not.toHaveProperty('stateDocument');
    expect(result[0]).not.toHaveProperty('internalFlags');
    expect(result[0]).toEqual({
      id: 'c1',
      dataSourceId: 'ds1',
      streamName: 's1',
      createdAt,
      updatedAt: expect.any(Date),
      ageMs: 0,
      paused: false,
      stale: false,
    });
  });
});

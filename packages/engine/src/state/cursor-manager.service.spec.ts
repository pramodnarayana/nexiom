import { describe, it, expect, beforeEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { CursorManagerService, DEFAULT_CURSOR_CHECKPOINT_INTERVAL } from './cursor-manager.service.js';
import type { StreamBookmark } from './cursor-manager.types.js';
import type { StreamDescriptor, PollRecord } from '@nexiom/connectors/framework';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockConfig(overrides: Record<string, unknown> = {}): ConfigService {
  return {
    get: <T>(key: string) => (overrides[key] as T | undefined) ?? undefined,
    getOrThrow: <T>(key: string) => {
      if (!(key in overrides)) throw new Error(`Missing config: ${key}`);
      return overrides[key] as T;
    },
  } as unknown as ConfigService;
}

const INCREMENTAL_TS: StreamDescriptor = {
  streamName: 'Account',
  replicationMethod: 'INCREMENTAL',
  replicationKey: 'UpdatedAt',
  replicationKeyType: 'timestamp',
  keyProperties: ['Id'],
};

const INCREMENTAL_NUM: StreamDescriptor = {
  streamName: 'Invoice',
  replicationMethod: 'INCREMENTAL',
  replicationKey: 'Id',
  replicationKeyType: 'numeric',
  keyProperties: ['Id'],
};

const INCREMENTAL_OPAQUE: StreamDescriptor = {
  streamName: 'Lead',
  replicationMethod: 'INCREMENTAL',
  replicationKey: 'cursor',
  replicationKeyType: 'opaque',
  keyProperties: ['Id'],
};

const FULL_TABLE: StreamDescriptor = {
  streamName: 'Product',
  replicationMethod: 'FULL_TABLE',
  keyProperties: ['Id'],
};

function bookmark(value: string | number, type: StreamBookmark['replication_key_type']): StreamBookmark {
  return { replication_key: 'UpdatedAt', replication_key_value: value, replication_key_type: type };
}

function records(...values: (string | number)[]): PollRecord[] {
  return values.map((v) => ({
    data: {},
    replicationKey: 'UpdatedAt',
    replicationKeyValue: v,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CursorManagerService', () => {
  let service: CursorManagerService;

  beforeEach(() => {
    service = new CursorManagerService(mockConfig());
  });

  // ── onModuleInit ──────────────────────────────────────────────────────────

  it('logs on startup without throwing', () => {
    expect(() => service.onModuleInit()).not.toThrow();
  });

  it('exposes the default checkpoint interval', () => {
    expect(service.checkpointInterval).toBe(DEFAULT_CURSOR_CHECKPOINT_INTERVAL);
  });

  it('reads CURSOR_CHECKPOINT_INTERVAL from config', () => {
    const svc = new CursorManagerService(mockConfig({ CURSOR_CHECKPOINT_INTERVAL: 25 }));
    expect(svc.checkpointInterval).toBe(25);
  });

  // ── calculateWindow — timestamp ───────────────────────────────────────────

  describe('calculateWindow — timestamp', () => {
    it('returns epoch lower bound on first run (no bookmark)', () => {
      const w = service.calculateWindow(undefined, INCREMENTAL_TS);
      expect(w.replicationKeyType).toBe('timestamp');
      if (w.replicationKeyType === 'timestamp') {
        expect(w.lowerBound).toBe(new Date(0).toISOString());
        expect(new Date(w.upperBound).getTime()).toBeGreaterThan(0);
      }
    });

    it('applies 5-minute default safety buffer to existing bookmark', () => {
      const bookmarkTime = new Date('2026-03-01T12:00:00.000Z');
      const w = service.calculateWindow(
        bookmark(bookmarkTime.toISOString(), 'timestamp'),
        INCREMENTAL_TS,
      );
      if (w.replicationKeyType === 'timestamp') {
        const expectedLower = new Date(bookmarkTime.getTime() - 5 * 60_000).toISOString();
        expect(w.lowerBound).toBe(expectedLower);
      }
    });

    it('applies configurable safety buffer', () => {
      const svc = new CursorManagerService(mockConfig({ CURSOR_SAFETY_BUFFER_MINUTES: 10 }));

      const bookmarkTime = new Date('2026-03-01T12:00:00.000Z');
      const w = svc.calculateWindow(
        bookmark(bookmarkTime.toISOString(), 'timestamp'),
        INCREMENTAL_TS,
      );
      if (w.replicationKeyType === 'timestamp') {
        const expectedLower = new Date(bookmarkTime.getTime() - 10 * 60_000).toISOString();
        expect(w.lowerBound).toBe(expectedLower);
      }
    });

    it('upperBound is a snapshot fixed at call time', () => {
      const before = new Date();
      const w = service.calculateWindow(undefined, INCREMENTAL_TS);
      const after = new Date();
      if (w.replicationKeyType === 'timestamp') {
        const upper = new Date(w.upperBound).getTime();
        expect(upper).toBeGreaterThanOrEqual(before.getTime());
        expect(upper).toBeLessThanOrEqual(after.getTime());
      }
    });
  });

  // ── calculateWindow — numeric ─────────────────────────────────────────────

  describe('calculateWindow — numeric', () => {
    it("returns '0' lower bound on first run", () => {
      const w = service.calculateWindow(undefined, INCREMENTAL_NUM);
      expect(w).toEqual({ replicationKeyType: 'numeric', lowerBound: '0' });
    });

    it('returns last bookmark value as lower bound', () => {
      const w = service.calculateWindow(bookmark(1500, 'numeric'), INCREMENTAL_NUM);
      expect(w).toEqual({ replicationKeyType: 'numeric', lowerBound: '1500' });
    });
  });

  // ── calculateWindow — opaque ──────────────────────────────────────────────

  describe('calculateWindow — opaque', () => {
    it("returns '' lower bound on first run", () => {
      const w = service.calculateWindow(undefined, INCREMENTAL_OPAQUE);
      expect(w).toEqual({ replicationKeyType: 'opaque', lowerBound: '' });
    });

    it('passes through vendor cursor token as lower bound', () => {
      const w = service.calculateWindow(bookmark('queryLocator:abc123', 'opaque'), INCREMENTAL_OPAQUE);
      expect(w).toEqual({ replicationKeyType: 'opaque', lowerBound: 'queryLocator:abc123' });
    });
  });

  // ── calculateWindow — FULL_TABLE / LOG_BASED ──────────────────────────────

  describe('calculateWindow — non-incremental', () => {
    it('returns opaque empty window for FULL_TABLE', () => {
      const w = service.calculateWindow(undefined, FULL_TABLE);
      expect(w).toEqual({ replicationKeyType: 'opaque', lowerBound: '' });
    });

    it('ignores any existing bookmark for FULL_TABLE', () => {
      const w = service.calculateWindow(bookmark('ignored', 'opaque'), FULL_TABLE);
      expect(w).toEqual({ replicationKeyType: 'opaque', lowerBound: '' });
    });

    it('returns opaque empty window for LOG_BASED', () => {
      const logBased: StreamDescriptor = {
        streamName: 'AuditLog',
        replicationMethod: 'LOG_BASED',
        keyProperties: ['Id'],
      };
      expect(service.calculateWindow(undefined, logBased)).toEqual({
        replicationKeyType: 'opaque',
        lowerBound: '',
      });
    });
  });

  // ── calculateWindow — invalid bookmark guards ─────────────────────────────

  describe('calculateWindow — invalid bookmark guards', () => {
    it('falls back to epoch when timestamp bookmark value is not a valid date (H1)', () => {
      const w = service.calculateWindow(
        { replication_key: 'UpdatedAt', replication_key_value: 'not-a-date', replication_key_type: 'timestamp' },
        INCREMENTAL_TS,
      );
      expect(w.replicationKeyType).toBe('timestamp');
      if (w.replicationKeyType === 'timestamp') {
        expect(w.lowerBound).toBe(new Date(0).toISOString());
        expect(new Date(w.upperBound).getTime()).toBeGreaterThan(0);
      }
    });

    it('produces lowerBound === bookmarkTime when CURSOR_SAFETY_BUFFER_MINUTES is 0', () => {
      const svc = new CursorManagerService(mockConfig({ CURSOR_SAFETY_BUFFER_MINUTES: 0 }));
      const bookmarkTime = new Date('2026-03-01T12:00:00.000Z');
      const w = svc.calculateWindow(bookmark(bookmarkTime.toISOString(), 'timestamp'), INCREMENTAL_TS);
      expect(w.replicationKeyType).toBe('timestamp');
      if (w.replicationKeyType === 'timestamp') {
        expect(w.lowerBound).toBe(bookmarkTime.toISOString());
      }
    });
  });

  // ── trackHighWaterMark — numeric ──────────────────────────────────────────

  describe('trackHighWaterMark — numeric', () => {
    it('returns currentMax unchanged for empty records', () => {
      expect(service.trackHighWaterMark([], '100', 'numeric')).toBe('100');
    });

    it('returns the numeric max across records', () => {
      expect(service.trackHighWaterMark(records(50, 200, 150), '10', 'numeric')).toBe('200');
    });

    it('correctly compares multi-digit numbers (avoids string-sort pitfall)', () => {
      // '9' > '10' lexicographically but 9 < 10 numerically
      expect(service.trackHighWaterMark(records(9, 10), '0', 'numeric')).toBe('10');
    });

    it('does not go below currentMax when all records are lower', () => {
      expect(service.trackHighWaterMark(records(5, 3), '100', 'numeric')).toBe('100');
    });

    it('advances across multiple pages (stateless accumulation)', () => {
      let max = '0';
      max = service.trackHighWaterMark(records(10, 20), max, 'numeric');
      max = service.trackHighWaterMark(records(15, 30), max, 'numeric');
      max = service.trackHighWaterMark(records(5, 25), max, 'numeric');
      expect(max).toBe('30');
    });

    it('skips records with non-numeric replicationKeyValue and keeps existing max (H2)', () => {
      // 'abc' parses as NaN — should be skipped with a warning, not corrupt the max
      expect(service.trackHighWaterMark(records('abc' as unknown as number, 5), '10', 'numeric')).toBe('10');
    });

    it('throws when currentMax is not a valid number (H2)', () => {
      expect(() =>
        service.trackHighWaterMark(records(1), 'not-a-number', 'numeric'),
      ).toThrow('not a valid number');
    });

    it('handles floating-point keys correctly', () => {
      expect(service.trackHighWaterMark(records(1.5, 2.7, 1.9), '0', 'numeric')).toBe('2.7');
    });
  });

  // ── trackHighWaterMark — timestamp ────────────────────────────────────────

  describe('trackHighWaterMark — timestamp', () => {
    const T1 = '2026-01-01T00:00:00.000Z';
    const T2 = '2026-02-01T00:00:00.000Z';
    const T3 = '2026-03-01T00:00:00.000Z';

    it('returns the latest ISO-8601 timestamp', () => {
      expect(service.trackHighWaterMark(records(T1, T3, T2), T1, 'timestamp')).toBe(T3);
    });

    it('does not go below currentMax', () => {
      expect(service.trackHighWaterMark(records(T1), T3, 'timestamp')).toBe(T3);
    });

    it('advances across pages', () => {
      let max = T1;
      max = service.trackHighWaterMark(records(T2), max, 'timestamp');
      expect(max).toBe(T2);
      max = service.trackHighWaterMark(records(T3), max, 'timestamp');
      expect(max).toBe(T3);
    });
  });

  // ── trackHighWaterMark — opaque ───────────────────────────────────────────

  describe('trackHighWaterMark — opaque', () => {
    it('returns the last record value (last-write-wins)', () => {
      expect(
        service.trackHighWaterMark(records('cursor:a', 'cursor:b', 'cursor:c'), '', 'opaque'),
      ).toBe('cursor:c');
    });

    it('ignores currentMax for opaque (vendor controls semantics)', () => {
      expect(
        service.trackHighWaterMark(records('cursor:new'), 'cursor:old', 'opaque'),
      ).toBe('cursor:new');
    });

    it('returns currentMax when records is empty', () => {
      expect(service.trackHighWaterMark([], 'cursor:old', 'opaque')).toBe('cursor:old');
    });
  });
});

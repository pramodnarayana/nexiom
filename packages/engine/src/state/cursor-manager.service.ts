import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ReplicationKeyType, StreamDescriptor, PollWindow, PollRecord } from '@nexiom/connectors/framework';
import type { StreamBookmark } from './cursor-manager.types.js';

/**
 * How many poll pages to process before writing an intermediate checkpoint
 * to `public.sync_cursors`. Lower values reduce re-fetch on crash at the
 * cost of more DB writes. Callers (SchedulerWorker) read this constant.
 *
 * Override with the `CURSOR_CHECKPOINT_INTERVAL` environment variable.
 */
export const DEFAULT_CURSOR_CHECKPOINT_INTERVAL = 10;

/**
 * CursorManagerService
 *
 * Pure stateless service — all state lives in `public.sync_cursors`.
 * The SchedulerWorker is responsible for reading/writing the state document;
 * this service only computes the next window and advances the high-water mark.
 *
 * Two public methods:
 *   - `calculateWindow()` — derives the PollWindow from an existing bookmark
 *   - `trackHighWaterMark()` — returns the new max after processing a page
 */
@Injectable()
export class CursorManagerService implements OnModuleInit {
  private readonly logger = new Logger(CursorManagerService.name);
  readonly checkpointInterval: number;

  /** Safety buffer subtracted from the last bookmark for timestamp streams. */
  private readonly safetyBufferMs: number;

  constructor(private readonly config: ConfigService) {
    // ConfigService.get<number>() returns a string at runtime — coerce explicitly.
    // Use != null guard so that an intentional value of 0 is respected.
    const rawBuffer = this.config.get('CURSOR_SAFETY_BUFFER_MINUTES');
    const bufferMinutes = rawBuffer != null ? Number(rawBuffer) : 5;
    this.safetyBufferMs = bufferMinutes * 60_000;

    const rawInterval = this.config.get('CURSOR_CHECKPOINT_INTERVAL');
    this.checkpointInterval =
      rawInterval != null ? Number(rawInterval) : DEFAULT_CURSOR_CHECKPOINT_INTERVAL;
  }

  onModuleInit(): void {
    this.logger.log(
      `CursorManagerService initialised — safetyBuffer=${this.safetyBufferMs / 60_000}min, checkpointInterval=${this.checkpointInterval} pages`,
    );
  }

  /**
   * Computes the PollWindow to pass to `piece.poll()`.
   *
   * For INCREMENTAL streams:
   *   - `timestamp`: lowerBound = last bookmark minus safety buffer (epoch on first run);
   *                  upperBound = current wall-clock time, fixed for the whole run.
   *   - `numeric`:   lowerBound = last checkpointed sequence value ('0' on first run).
   *   - `opaque`:    lowerBound = raw vendor cursor token ('' on first run).
   *
   * For FULL_TABLE / LOG_BASED: returns an opaque window with empty lowerBound
   * (the connector ignores the window and fetches everything).
   */
  calculateWindow(
    bookmark: StreamBookmark | undefined,
    catalog: StreamDescriptor,
  ): PollWindow {
    if (catalog.replicationMethod !== 'INCREMENTAL') {
      return { replicationKeyType: 'opaque', lowerBound: '' };
    }

    const { replicationKeyType } = catalog;

    switch (replicationKeyType) {
      case 'timestamp': {
        const upperBound = new Date().toISOString();
        if (!bookmark) {
          return {
            replicationKeyType: 'timestamp',
            lowerBound: new Date(0).toISOString(),
            upperBound,
          };
        }
        const bookmarkMs = new Date(
          String(bookmark.replication_key_value),
        ).getTime();
        if (Number.isNaN(bookmarkMs)) {
          this.logger.warn(
            `Invalid timestamp bookmark value "${bookmark.replication_key_value}" — falling back to epoch lower bound`,
          );
          return {
            replicationKeyType: 'timestamp',
            lowerBound: new Date(0).toISOString(),
            upperBound,
          };
        }
        const lowerBound = new Date(
          bookmarkMs - this.safetyBufferMs,
        ).toISOString();
        return { replicationKeyType: 'timestamp', lowerBound, upperBound };
      }

      case 'numeric': {
        return {
          replicationKeyType: 'numeric',
          lowerBound: bookmark
            ? String(bookmark.replication_key_value)
            : '0',
        };
      }

      case 'opaque': {
        return {
          replicationKeyType: 'opaque',
          lowerBound: bookmark
            ? String(bookmark.replication_key_value)
            : '',
        };
      }

      default: {
        const _exhaustive: never = replicationKeyType;
        throw new Error(
          `calculateWindow: unhandled replicationKeyType "${_exhaustive}"`,
        );
      }
    }
  }

  /**
   * Advances the high-water mark after processing a page of records.
   *
   * Returns `currentMax` unchanged when `records` is empty so callers can
   * call this unconditionally without special-casing empty pages.
   *
   * Strategy per key type:
   *   - `timestamp`: lexicographic max (ISO-8601 strings sort correctly as strings)
   *   - `numeric`:   numeric max (avoids '9' > '10' string-sort pitfall)
   *   - `opaque`:    last-write-wins (the final record's value is the new cursor)
   */
  trackHighWaterMark(
    records: PollRecord[],
    currentMax: string,
    replicationKeyType: ReplicationKeyType,
  ): string {
    if (records.length === 0) return currentMax;

    switch (replicationKeyType) {
      case 'numeric': {
        const baseMax = Number(currentMax);
        if (Number.isNaN(baseMax)) {
          throw new Error(
            `trackHighWaterMark: currentMax "${currentMax}" is not a valid number`,
          );
        }
        let max = baseMax;
        for (const r of records) {
          const v = Number(r.replicationKeyValue);
          if (Number.isNaN(v)) {
            this.logger.warn(
              `trackHighWaterMark: skipping record with non-numeric replicationKeyValue "${r.replicationKeyValue}"`,
            );
            continue;
          }
          if (v > max) max = v;
        }
        return String(max);
      }

      case 'timestamp': {
        let max = currentMax;
        for (const r of records) {
          const v = String(r.replicationKeyValue);
          if (v > max) max = v;
        }
        return max;
      }

      case 'opaque': {
        // The connector controls cursor semantics — trust the last record.
        return String(records[records.length - 1]!.replicationKeyValue);
      }

      default: {
        const _exhaustive: never = replicationKeyType;
        throw new Error(
          `trackHighWaterMark: unhandled replicationKeyType "${_exhaustive}"`,
        );
      }
    }
  }
}

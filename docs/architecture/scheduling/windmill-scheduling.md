# Architecture: Stateful Sync — Windmill + Cursor Manager

## Overview

The FluxNex sync pipeline uses two complementary systems:

| System | Role |
| --- | --- |
| **Windmill** | Master Clock — owns cron schedules, script execution, retry logic, failure alerts, and run history |
| **CursorManagerService** | Memory — owns incremental state, polling windows, high-water marks, and crash-safe checkpointing |

Windmill decides **when** to poll. CursorManagerService decides **where to start** and **where to stop**.

**Why Windmill over DolphinScheduler:**

- **No JVM / Zookeeper overhead** — Windmill is written in Go and Rust; the only backing store is PostgreSQL (shared with the existing Nexiom instance, separate database).
- **Native TypeScript workers** — the execution script runs in a Deno runtime inside a Windmill worker; no HTTP-task abstraction layer.
- **Simpler tenancy** — schedules are addressed by path (`f/stitches/{stitchId}`); no per-org "project code" needs to be stored.
- **One fewer backing service** — no Zookeeper, no separate cluster registry.
- **Built-in UI** — run history, manual triggers, and schedule management are available in the Windmill dashboard out of the box.

---

## 1. Core Philosophy: The Bookmark Model

Instead of a naive `updated_at` query, sync state is modelled as a **Singer-style Bookmark** JSON document. A single stitch can track multiple independent data streams (e.g. `Account`, `rtms__Load__c`, `Invoice`) simultaneously without losing its place in any of them.

The bookmark includes a `replication_key_type` discriminator so `CursorManagerService` knows how to compare values safely across connectors that use timestamps, integer sequences, or opaque vendor cursors.

---

## 2. System Architecture

### 2A. Windmill — The Master Clock

Windmill is deployed as a sidecar alongside the NestJS API. It acts as the sole authority on **when** a poll run fires.

**Conceptual mapping:**

| Windmill Concept | Nexiom Mapping |
| --- | --- |
| Workspace | `NEXIOM` — one shared workspace for all tenants |
| Script | Stitch runner — one shared `f/stitch-runner/main` TypeScript script |
| Schedule | One schedule per stitch at path `f/stitches/{stitchId}` |
| Schedule args | `{ "stitchId": "<uuid>" }` — parameterises the shared script per stitch |
| Cron expression | Derived from `syncIntervalMinutes` (see §2B) |
| Worker Group | `default` (local dev); `production`/`sandbox` for env isolation in production |

**What Windmill provides out of the box:**

- Visual schedule/run history dashboard
- Native cron scheduling with seconds-level precision
- Built-in retry on script failure (configurable per script or per schedule)
- Timeout enforcement (kills hung workers)
- Manual trigger via UI or REST API
- Concurrent-execution limits (set `concurrent_limit: 1` on the stitch-runner script)
- Error handlers: execute a notification script on any schedule failure (Enterprise)

### 2B. Interval → Cron Mapping

Windmill uses the extended cron syntax from the `croner` library (same second-level field as Quartz).

| `syncIntervalMinutes` | Cron Expression |
| --- | --- |
| 30 | `0 0/30 * * * *` |
| 60 | `0 0 * * * *` |
| 120 | `0 0 0/2 * * *` |
| 240 | `0 0 0/4 * * *` |
| 360 | `0 0 0/6 * * *` |
| 720 | `0 0 0/12 * * *` |
| 1440 | `0 0 0 * * *` |

### 2C. The Stitch Runner Script

The Windmill worker executes a TypeScript Deno script. It is thin by design — all orchestration logic lives in NestJS. The script's sole responsibility is to HTTP-call the NestJS internal endpoint and propagate the result.

```typescript
// Windmill script path: f/stitch-runner/main
// Stored in Windmill's database; pushed via WindmillClient.ensureStitchScript() on service init.
// Runs inside a Deno sandbox on Windmill workers.

import * as wmill from "npm:windmill-client@1";

export async function main(stitchId: string): Promise<object> {
  const apiUrl = await wmill.getVariable("f/config/NEXIOM_API_URL");
  const secret  = await wmill.getVariable("f/config/WINDMILL_INTERNAL_SECRET");

  const response = await fetch(
    `${apiUrl}/internal/scheduler/execute-stitch`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ stitchId }),
    },
  );

  if (!response.ok) {
    // Non-2xx causes Windmill to mark the run FAILURE → triggers retry DAG
    const body = await response.text();
    throw new Error(`Stitch execution failed [${response.status}]: ${body}`);
  }

  // Return value is stored in Windmill's job result history (JSON)
  return await response.json();
}
```

Secrets (`NEXIOM_API_URL`, `WINDMILL_INTERNAL_SECRET`) are stored as Windmill variables at `f/config/*` — readable by all workers, never exposed to external callers.

### 2D. CursorManagerService — The Memory

Every time Windmill fires a schedule, it calls the NestJS `/internal/scheduler/execute-stitch` endpoint. The `SchedulerWorker` then interacts with `CursorManagerService` in three sequential phases:

#### Phase A — Window Calculator (Pre-Poll)

- Resolves `stitchId → (srcConnectionId, sourceObject)` from `integration_stitch`.
- Calls `piece.describeStreams(credentials)` to obtain the `StreamDescriptor` (replication key type, key properties). Required on every run so the type is known even before any bookmark exists.
- Reads the current `SyncStateDocument` from `public.sync_cursors` for `(stitchId, streamName)`.
- If `state.currently_syncing == streamName` — the previous run crashed mid-pagination; restores `bookmark.offset` as the starting `nextPageCursor` and resumes from the last saved page.
- Otherwise — fresh run; sets `currently_syncing`, clears any stale offset.
- Calls `CursorManagerService.calculateWindow(bookmark, catalog)`:
  - **timestamp** keys: subtracts `CURSOR_SAFETY_BUFFER_MINUTES` from `replication_key_value`.
  - **numeric** keys: uses the raw value as lower bound; no buffer.
  - **opaque** keys: passes the raw token through unchanged.
  - First run (no bookmark): returns `'1970-01-01T00:00:00.000Z'` for timestamps, `'0'` for numeric.

#### Phase B — High-Water Tracker (During Poll)

- For each page of records yielded by `piece.poll()`, identifies the maximum `replication_key_value` across all records.
- Comparison is **numeric** for `numeric` keys; **lexicographic** (safe for ISO-8601) for `timestamp` keys; last-write-wins for `opaque` keys.
- Holds the maximum in **volatile memory**.
- Issues an **intermediate checkpoint** every `CURSOR_CHECKPOINT_INTERVAL` pages (default 10). Each intermediate checkpoint saves both the current high-water mark **and** the current `nextPageCursor` as `bookmark.offset` — so a crash on page N restarts at page N, not at the high-water mark.

#### Phase C — Checkpoint Engine (Post-Poll)

- Commits the final high-water mark to `public.sync_cursors` **only after** the batch is successfully written to `inbound_gateway`.
- Clears `bookmark.offset` and `currently_syncing` on success.
- If the worker dies mid-sync, `currently_syncing` remains set and `bookmark.offset` holds the last saved page cursor. Phase A of the next run detects this and resumes. L2's `INSERT ... ON CONFLICT DO UPDATE` deduplicates any re-fetched records.

### Full Poll Run Sequence

```text
Windmill (cron fires for schedule f/stitches/{stitchId})
    │
    │  Windmill worker executes: f/stitch-runner/main({ stitchId })
    │
    │  POST /internal/scheduler/execute-stitch  { stitchId }
    │  Authorization: Bearer <WINDMILL_INTERNAL_SECRET>
    │
    ▼
NestJS  SchedulerWorker
    │
    ├─ 0. Validate Bearer token against WINDMILL_INTERNAL_SECRET
    │
    ├─ 1. Lookup  stitchId → { srcConnectionId, sourceObject }  from integration_stitch
    │       (returns 404 if stitch deleted mid-flight)
    │
    ├─ 2. Acquire Redis lock  lock:poll:{stitchId}:{streamName}  (return SKIPPED → HTTP 200 if unavailable)
    │
    ├─ 3. Call piece.describeStreams(credentials)  →  StreamDescriptor[]
    │       (provides replicationKeyType + keyProperties before any state exists)
    │
    ├─ 4. Read SyncStateDocument from  public.sync_cursors  keyed on (stitchId, streamName)
    │       ├─ If state.currently_syncing == streamName  →  crash-resume: restore offset cursor
    │       └─ Else  →  fresh run: set state.currently_syncing = streamName, clear offset
    │
    ├─ 5. CursorManagerService.calculateWindow(bookmark, catalog)
    │       →  { lowerBound, upperBound, replicationKeyType }
    │
    ├─ 6. For each page from piece.poll(credentials, streamName, window, nextPageCursor):
    │       ├─ CursorManagerService.trackHighWaterMark(records, currentMax, replicationKeyType)
    │       ├─ INSERT batch  →  inbound_gateway  (see §12 for pipeline context)
    │       ├─ Enqueue batch  →  Inbound_Queue  (SQS / BullMQ)
    │       └─ [every N pages] intermediate checkpoint  →  sync_cursors
    │             (saves both high-water mark AND current nextPageCursor as bookmark.offset)
    │
    ├─ 7. Final checkpoint  →  sync_cursors
    │       (commits high-water mark, clears bookmark.offset, clears currently_syncing)
    │
    ├─ 8. Update  integration_stitch.last_scheduled_at
    │
    ├─ 9. Release Redis lock
    │
    └─ 10. Return HTTP 200  { status: 'SUCCESS', streams: [{ streamName, recordsIngested, newHighWaterMark }] }
                │
                ▼
        Windmill records job result (JSON) in run history
```

**Windmill retry behaviour:** if the NestJS endpoint returns non-2xx, the Deno script throws an exception and Windmill marks the job `FAILURE`. The retry policy (max retries, backoff) is set on the script definition and applies to every schedule that references it.

**`SKIPPED` returns HTTP 200** — a skipped run means the previous run is still active. Returning 2xx prevents Windmill from treating the execution as a failure and triggering the retry policy.

**Crash recovery:** If the NestJS worker dies mid-pagination, `bookmark.offset` holds the last persisted `nextPageCursor` and `currently_syncing` is set. On the next Windmill-triggered run, step 4 detects the interrupted stream and resumes from the saved page cursor.

---

## 3. Windmill Lifecycle — Stitch CRUD

Every stitch create/update/delete operation is mirrored to Windmill via the `WindmillClient`. The stitch-runner script (`f/stitch-runner/main`) is provisioned once during service init (`WindmillClient.ensureStitchScript()`) and shared across all stitches.

**No per-org project concept:** Each stitch's schedule is addressed directly by path. The org-to-stitch relationship is enforced by Nexiom's own DB (via `integration_stitch.orgId`), not by Windmill workspace partitioning.

| Stitch Action | Windmill Action |
| --- | --- |
| `POST /stitches` (`scheduleEnabled=true`) | `POST /api/w/nexiom/schedules` → create schedule at `f/stitches/{stitchId}` with cron + args `{ stitchId }` |
| `POST /stitches` (`scheduleEnabled=false`) | Create schedule with `enabled: false` |
| `PATCH /stitches/:id/schedule` (update interval) | `POST /api/w/nexiom/schedules/update/f/stitches/{stitchId}` → new cron |
| `PATCH /stitches/:id/schedule` (`scheduleEnabled=false`) | `POST /api/w/nexiom/schedules/setenabled/f/stitches/{stitchId}` → `{ enabled: false }` |
| `PATCH /stitches/:id/schedule` (`scheduleEnabled=true`) | `POST /api/w/nexiom/schedules/setenabled/f/stitches/{stitchId}` → `{ enabled: true }` |
| `POST /stitches/:id/schedule/trigger` | `POST /api/w/nexiom/jobs/run/p/f/stitch-runner/main` → `{ args: { stitchId } }` |
| `DELETE /stitches/:id` | `DELETE /api/w/nexiom/schedules/delete/f/stitches/{stitchId}` |
| `DELETE /organization/:id` | Delete all schedules for `orgId` (WindmillClient queries `listSchedules()` filtered by `orgId` prefix) |

**No `ds_project_code` analogue is needed.** Schedule paths are derived deterministically from `stitchId`. The `organization.ds_project_code` column added during the DS design phase should be removed in the next migration.

---

## 4. Database Schema — `public.sync_cursors`

Lives in the **shared control-plane schema**. The SchedulerWorker reads and writes this table directly without switching `search_path`.

| Column | Type | Description |
| --- | --- | --- |
| `id` | `UUID` | Primary key |
| `stitch_id` | `UUID` | FK → `integration_stitch.id` ON DELETE CASCADE |
| `stream_name` | `VARCHAR(200)` | Object/stream name (e.g. `Account`, `rtms__Load__c`) |
| `state_document` | `JSONB` | Singer-style state for **this row's stream only** (see §5). Default: `{"bookmarks":{},"versions":{},"currently_syncing":null}` |
| `created_at` | `TIMESTAMPTZ` | Row creation timestamp — when the stream was first synced |
| `updated_at` | `TIMESTAMPTZ` | Last successful checkpoint timestamp |

**Unique index:** `(stitch_id, stream_name)` — one row per stream **per stitch**. Stitches that share the same source connection + stream name each have their own independent cursor row so advancing one never affects the other.

**Single-stream invariant:** Each row's `state_document.bookmarks` and `state_document.versions` will always contain exactly one key — the `stream_name` of that row. The `Record<string, ...>` type is used for Singer tooling compatibility, not to allow multi-stream documents per row.

> **Why `stitch_id` not `connection_id`:** Using `connection_id` as the key would cause two stitches sharing the same Salesforce connection and polling the same `Account` stream to collide on a single cursor row. Stitch A advancing its high-water mark would silently suppress records for Stitch B on its next run.

**Distinct from `ws_{id}.sync_cursor`:** the per-tenant workspace `sync_cursor` table (T026) tracks L2 replication state. `public.sync_cursors` tracks what has been fetched from the **source** SaaS API.

---

## 5. Singer-Style State Payload (JSONB)

Each `sync_cursors` row is scoped to a single `(stitch_id, stream_name)` pair. The `state_document` for the row tracking `stitch-abc / rtms__Load__c` looks like:

```json
{
  "bookmarks": {
    "rtms__Load__c": {
      "replication_key": "SystemModstamp",
      "replication_key_value": "2026-03-22T09:45:00.000Z",
      "replication_key_type": "timestamp",
      "offset": {}
    }
  },
  "versions": {
    "rtms__Load__c": 1
  },
  "currently_syncing": null
}
```

`bookmarks` and `versions` always contain exactly one key matching the row's `stream_name`.

**Field semantics (aligned with singer-python `state.py` conventions):**

- `bookmarks.{stream}.replication_key` — the field name used as the replication key.
- `bookmarks.{stream}.replication_key_value` — the highest value successfully checkpointed.
- `bookmarks.{stream}.replication_key_type` — FluxNex extension (not in Singer base spec). Tells `CursorManagerService` how to compare and format the value (`timestamp` / `numeric` / `opaque`).
- `bookmarks.{stream}.offset` — Singer pagination offset. Persisted after each page for crash resumption. Cleared on successful run completion.
- `versions.{stream}` — Singer ACTIVATE_VERSION semantics. Incremented when a full-table reload is triggered. Stored at the top level, not inside the bookmark, per singer-python convention.
- `currently_syncing` — the stream currently being polled. Set before polling starts; cleared on completion. Used by crash-recovery logic to resume the interrupted stream first on the next run.

---

## 6. TypeScript Interfaces

```typescript
// packages/connectors/src/framework/piece.ts
// (PollWindow, PollRecord, PollPage, StreamDescriptor defined here)

export type ReplicationKeyType = 'timestamp' | 'numeric' | 'opaque';

// Discriminated union — each variant exposes only the bounds meaningful for its key type.
// Numeric/opaque streams must not receive an ISO upperBound.
export type PollWindow =
  | { replicationKeyType: 'timestamp'; lowerBound: string; upperBound: string }
  | { replicationKeyType: 'numeric';   lowerBound: string }
  | { replicationKeyType: 'opaque';    lowerBound: string };

export interface PollRecord {
  data: Record<string, unknown>;
  replicationKey: string;
  replicationKeyValue: string | number;
}

export interface PollPage {
  streamName: string;
  records: PollRecord[];
  // Connector-specific pagination state; persisted to bookmark.offset for crash resumption.
  nextPageCursor?: Record<string, unknown>;
}

// StreamDescriptor discriminated union:
//   INCREMENTAL → replicationKey + replicationKeyType required (compile-time enforced)
//   FULL_TABLE | LOG_BASED → forbidden via `never`
// keyProperties: [string, ...string[]] — non-empty; L2 always has a conflict target for UPSERT.

// poll() signature — streamName explicitly identifies which stream to fetch.
// poll(
//   credentials: Record<string, unknown>,
//   streamName: string,
//   window: PollWindow,
//   nextPageCursor?: Record<string, unknown>,
// ): Promise<PollPage>
```

```typescript
// packages/engine/src/state/cursor-manager.types.ts

import type { ReplicationKeyType, StreamDescriptor } from '@nexiom/connectors/framework';

export interface StreamBookmark {
  replication_key: string;
  replication_key_value: string | number;
  replication_key_type: ReplicationKeyType;
  offset?: Record<string, unknown>;
}

export interface SyncStateDocument {
  bookmarks: Record<string, StreamBookmark>;
  versions: Record<string, number>;
  currently_syncing: string | null;
}

/** Payload Windmill sends to POST /internal/scheduler/execute-stitch */
export interface ExecuteStitchPayload {
  stitchId: string;
}

export interface StreamResult {
  streamName: string;
  recordsIngested: number;
  newHighWaterMark?: string;
}

/** Response returned to Windmill — non-2xx causes the Deno script to throw → job FAILURE → retry */
export interface ExecuteStitchResult {
  status: 'SUCCESS' | 'SKIPPED';
  streams: StreamResult[];
}
```

---

## 7. CursorManagerService

```typescript
// packages/engine/src/state/cursor-manager.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import dayjs from 'dayjs';
import type { ReplicationKeyType, StreamDescriptor, PollRecord, PollWindow } from '@nexiom/connectors/framework';
import type { StreamBookmark } from './cursor-manager.types.js';

@Injectable()
export class CursorManagerService {
  private readonly logger = new Logger(CursorManagerService.name);
  private readonly safetyBufferMinutes: number;

  constructor(private readonly config: ConfigService) {
    const raw = this.config.get<string>('CURSOR_SAFETY_BUFFER_MINUTES');
    const parsed = raw !== undefined ? parseInt(raw, 10) : NaN;
    this.safetyBufferMinutes = Number.isFinite(parsed) && parsed >= 0 ? parsed : 5;
    this.logger.log(`CursorManagerService initialised — SAFETY_BUFFER=${this.safetyBufferMinutes}min`);
  }

  /**
   * Phase A — Calculate the safe polling window.
   * Throws for non-INCREMENTAL streams (FULL_TABLE / LOG_BASED have no cursor window).
   */
  calculateWindow(bookmark: StreamBookmark | undefined, catalog: StreamDescriptor): PollWindow {
    if (catalog.replicationMethod !== 'INCREMENTAL') {
      throw new Error(
        `calculateWindow called for non-INCREMENTAL stream "${catalog.streamName}" ` +
        `(replicationMethod=${catalog.replicationMethod}). ` +
        `Only INCREMENTAL streams use cursor windows.`,
      );
    }

    const upperBound = dayjs().toISOString();
    const replicationKeyType: ReplicationKeyType =
      bookmark?.replication_key_type ?? catalog.replicationKeyType;

    if (!bookmark) {
      if (replicationKeyType === 'numeric') return { replicationKeyType, lowerBound: '0' };
      if (replicationKeyType === 'opaque')  return { replicationKeyType, lowerBound: '' };
      return { replicationKeyType, lowerBound: '1970-01-01T00:00:00.000Z', upperBound };
    }

    if (replicationKeyType === 'timestamp') {
      const parsed = dayjs(bookmark.replication_key_value as string);
      const lowerBound = parsed.isValid()
        ? parsed.subtract(this.safetyBufferMinutes, 'minute').toISOString()
        : '1970-01-01T00:00:00.000Z';
      return { replicationKeyType, lowerBound, upperBound };
    }

    return { replicationKeyType, lowerBound: String(bookmark.replication_key_value) };
  }

  /**
   * Phase B — Advance the High-Water Mark.
   * Type-aware: numeric prevents lexicographic false-positives; opaque is last-write-wins.
   */
  trackHighWaterMark(
    records: PollRecord[],
    currentMax: string,
    replicationKeyType: ReplicationKeyType,
  ): string {
    if (replicationKeyType === 'opaque') {
      return records.length > 0 ? String(records[records.length - 1]!.replicationKeyValue) : currentMax;
    }

    let newMax = currentMax;
    for (const record of records) {
      const value = record.replicationKeyValue;
      if (replicationKeyType === 'numeric') {
        if (Number(value) > Number(newMax)) newMax = String(value);
      } else {
        if (String(value) > newMax) newMax = String(value);
      }
    }
    return newMax;
  }
}
```

---

## 8. WindmillClient

The `WindmillClient` wraps the Windmill REST API. It is injected into `SchedulerModule` and called from stitch lifecycle hooks.

```typescript
// apps/api/src/modules/scheduler/windmill.client.ts

export interface WindmillScheduleInfo {
  /** Full schedule path (e.g. 'f/stitches/{stitchId}'). */
  path: string;
  enabled: boolean;
  cron: string;
}

export abstract class WindmillClient {
  /**
   * Ensure the shared stitch-runner script exists in Windmill.
   * Called once at SchedulerModule init via onModuleInit().
   * Idempotent — safe to call on every server startup.
   */
  abstract ensureStitchScript(): Promise<void>;

  /**
   * Create a Windmill schedule for a stitch.
   * Schedule path: f/stitches/{stitchId}
   * Script path:   f/stitch-runner/main
   * Args:          { stitchId }
   */
  abstract scheduleStitch(stitchId: string, cron: string, enabled?: boolean): Promise<WindmillScheduleInfo>;

  /** Update the cron expression for an existing stitch schedule. */
  abstract updateScheduleCron(stitchId: string, cron: string): Promise<void>;

  /** Enable (resume) an existing stitch schedule. */
  abstract enableSchedule(stitchId: string): Promise<void>;

  /** Disable (pause) an existing stitch schedule. */
  abstract disableSchedule(stitchId: string): Promise<void>;

  /**
   * Trigger a one-shot immediate run (manual trigger).
   * Returns the Windmill job UUID.
   */
  abstract triggerOnce(stitchId: string): Promise<string>;

  /** Delete the stitch schedule. Called when a stitch is deleted. */
  abstract deleteSchedule(stitchId: string): Promise<void>;

  /**
   * Delete all schedules belonging to an org.
   * Called during org offboarding. Lists schedules with path prefix f/stitches/,
   * then cross-references against DB to identify this org's stitches.
   */
  abstract deleteOrgSchedules(stitchIds: string[]): Promise<void>;
}
```

**Windmill REST API endpoints used:**

| Operation | HTTP Call |
| --- | --- |
| Create schedule | `POST /api/w/nexiom/schedules` |
| Update cron | `POST /api/w/nexiom/schedules/update/f/stitches/{stitchId}` |
| Enable/disable | `POST /api/w/nexiom/schedules/setenabled/f/stitches/{stitchId}` |
| Delete schedule | `DELETE /api/w/nexiom/schedules/delete/f/stitches/{stitchId}` |
| Trigger once (async) | `POST /api/w/nexiom/jobs/run/p/f/stitch-runner/main` |
| Create/update script | `POST /api/w/nexiom/scripts/create` |
| List schedules | `GET /api/w/nexiom/schedules/list` |

All calls use `Authorization: Bearer <WINDMILL_TOKEN>` where `WINDMILL_TOKEN` is a Windmill API token with admin rights to the `nexiom` workspace.

**`StubWindmillClient`** (for tests / non-production environments): implements `WindmillClient` with in-memory state. Injected when `WINDMILL_ENABLED=false`. This allows stitch CRUD to work without a live Windmill instance during local development or unit tests.

---

## 9. Endpoint Security — `/internal/scheduler/execute-stitch`

This endpoint must **not** be exposed on the public API port. Two layers of protection:

1. **Network isolation:** Windmill workers and NestJS share an internal Docker network. The endpoint is not routed through the public reverse proxy.
2. **Shared secret guard:** The Windmill stitch-runner script reads `WINDMILL_INTERNAL_SECRET` from Windmill's variable store and injects it as `Authorization: Bearer <WINDMILL_INTERNAL_SECRET>` on every call. The NestJS `InternalSchedulerGuard` validates this header before the handler runs.

If the Authorization header is missing or invalid, the endpoint returns `401`. The Deno script throws on non-2xx → Windmill marks the job `FAILURE` → retry policy fires.

**Secret rotation:** update the value in both Windmill (`f/config/WINDMILL_INTERNAL_SECRET`) and the NestJS env. There is a brief window during rotation where a run may fail once; the retry policy absorbs it.

---

## 10. Enterprise Edge Case Handling

### 10.1 Safety Buffer Duplicates

Windmill fires cron on schedule. The SchedulerWorker intentionally re-fetches the last N minutes of records on each run (safety buffer).

**Resolution:** L2 (`ReplicaService`) uses `INSERT ... ON CONFLICT (entity_type, source_id) DO UPDATE` — safety-buffer duplicates are silently merged.

### 10.2 Pagination Crash Recovery

Windmill enforces a per-script timeout (set on the script definition, e.g. 30 minutes). If the poll run times out mid-pagination, the cursor is not fully advanced.

**Resolution:** Intermediate checkpoints every `CURSOR_CHECKPOINT_INTERVAL` pages (default: 10). A timeout on page 50 loses at most 10 pages of progress. The next Windmill-triggered run detects `currently_syncing` and resumes from `bookmark.offset`.

### 10.3 Concurrent Poll Prevention

Windmill's `concurrent_limit` on the stitch-runner script prevents more than one execution from running simultaneously per path — set `concurrency_key: "{{args.stitchId}}"` so the limit is per-stitch, not global. As a secondary guard, the SchedulerWorker acquires Redis lock `lock:poll:{stitchId}:{streamName}` and returns `SKIPPED` (HTTP 200) if unavailable.

`SKIPPED` returns HTTP 200 — Windmill must not treat this as a failure or retry.

### 10.4 Stale Cursor Detection

If `sync_cursors.updated_at` age exceeds `2 × syncIntervalMinutes`, the cursor is stale. Windmill run history will show repeated `SUCCESS` with `recordsIngested=0`.

**Resolution:** SchedulerWorker emits a `cursor_stale` Prometheus counter. Exception Center monitors `recordsIngested=0` streaks and surfaces actionable alerts.

### 10.5 Full Refresh Trigger

`DELETE /admin/stitches/:id/cursor/:streamName` removes the `sync_cursors` row. The next Windmill-triggered run detects no bookmark and falls back to the epoch lower bound.

Manual trigger via `POST /stitches/:id/schedule/trigger` → `WindmillClient.triggerOnce()` → `POST /api/w/nexiom/jobs/run/p/f/stitch-runner/main` with `{ stitchId }`.

### 10.6 Windmill Failure → Retry Policy

If the NestJS endpoint returns non-2xx, the Deno script throws and Windmill marks the job `FAILURE`. The retry policy on the stitch-runner script fires (configurable: e.g. 3 retries with exponential backoff). After all retries are exhausted, Windmill can invoke a designated error handler script (Enterprise) that posts to the Exception Center.

### 10.7 Schedule Bootstrap on Service Start

`WindmillClient.ensureStitchScript()` is called during `SchedulerModule.onModuleInit()`. If the stitch-runner script is missing (e.g. fresh Windmill instance), it is created idempotently. This prevents a failed deploy from leaving schedules without a backing script.

---

## 11. Infrastructure — Windmill Deployment

Windmill runs as two Docker services (server + worker) sharing the existing PostgreSQL instance via a dedicated `windmill` database. No Zookeeper or JVM required.

```yaml
# docker-compose additions

x-windmill-env: &windmill-env
  DATABASE_URL: postgres://${POSTGRES_USER:-user}:${POSTGRES_PASSWORD:-password}@postgres:5432/windmill
  BASE_URL: ${WINDMILL_BASE_URL:-http://localhost:8000}

services:
  # ----- Windmill DB Init (ephemeral, runs once) -----
  # Creates the 'windmill' database and runs Windmill's schema migrations.
  windmill_init:
    image: ghcr.io/windmill-labs/windmill:v1.662.0
    pull_policy: always
    command: ["windmill", "init"]
    environment:
      <<: *windmill-env
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - nexiom-network

  # ----- Windmill Server (stateless API + UI) -----
  windmill_server:
    image: ghcr.io/windmill-labs/windmill:v1.662.0
    pull_policy: always
    restart: unless-stopped
    environment:
      <<: *windmill-env
      MODE: server
    depends_on:
      postgres:
        condition: service_healthy
      windmill_init:
        condition: service_completed_successfully
    ports:
      - "8000:8000"
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:8000/api/health || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 10
      start_period: 120s
    networks:
      - nexiom-network

  # ----- Windmill Worker (executes stitch-runner scripts) -----
  windmill_worker:
    image: ghcr.io/windmill-labs/windmill:v1.662.0
    pull_policy: always
    restart: unless-stopped
    # privileged required for ENABLE_UNSHARE_PID
    privileged: true
    deploy:
      replicas: 2
    environment:
      <<: *windmill-env
      MODE: worker
      WORKER_GROUP: default
      ENABLE_UNSHARE_PID: "true"
    depends_on:
      windmill_server:
        condition: service_healthy
    networks:
      - nexiom-network
```

**Postgres init script** (`scripts/create-windmill-db.sh`) — mounts into postgres `/docker-entrypoint-initdb.d/`:

```bash
#!/bin/bash
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE windmill'
    WHERE NOT EXISTS (
        SELECT FROM pg_database WHERE datname = 'windmill'
    )\gexec
EOSQL
```

**NestJS API service additions:**

```yaml
api:
  environment:
    WINDMILL_BASE_URL: http://windmill_server:8000
    WINDMILL_TOKEN: ${WINDMILL_TOKEN}
    WINDMILL_WORKSPACE: nexiom
    WINDMILL_INTERNAL_SECRET: ${WINDMILL_INTERNAL_SECRET}
    WINDMILL_ENABLED: "true"
  depends_on:
    windmill_server:
      condition: service_healthy
```

**Environment variables:**

| Variable | Description |
| --- | --- |
| `WINDMILL_BASE_URL` | Windmill server URL (e.g. `http://windmill_server:8000`) |
| `WINDMILL_TOKEN` | Windmill API token — admin rights on the `nexiom` workspace |
| `WINDMILL_WORKSPACE` | Windmill workspace name (default: `nexiom`) |
| `WINDMILL_INTERNAL_SECRET` | Shared secret injected by stitch-runner into every `execute-stitch` call. Min 32 bytes, randomly generated per deployment. |
| `WINDMILL_ENABLED` | Set `false` to use `StubWindmillClient` (local dev without Windmill) |

---

## 12. Schema Migration: Removing `ds_project_code`

The `organization.ds_project_code` column was designed to persist DolphinScheduler's numeric project codes. With Windmill, schedule paths are derived from `stitchId` (`f/stitches/{stitchId}`) and require no per-org state.

**Migration steps:**

1. Drop the `ds_project_code` column from `organization` in `packages/database/src/schema/identity.ts`.
2. Remove the `ds_project_code_safe_integer` CHECK constraint and `organization_ds_project_code_unique_idx` index.
3. Generate migration: `pnpm --filter api db:generate`.
4. Update `mkOrg()` fixture in `drizzle-tenant.adapter.spec.ts` (remove `dsProjectCode` field).
5. Remove any `dsProjectCode` references in `DrizzleTenantAdapter` and identity interfaces.

---

## 13. Integration with the 6-Layer Pipeline

```text
[Windmill]  schedule f/stitches/{stitchId} fires
              │
              │  Windmill worker runs f/stitch-runner/main({ stitchId })
              │
              │  POST /internal/scheduler/execute-stitch  { stitchId }
              │  Authorization: Bearer <WINDMILL_INTERNAL_SECRET>
              │
[L0]  SchedulerWorker  (NestJS)
        ├─ stitchId → srcConnectionId + sourceObject  (DB lookup)
        ├─ CursorManagerService.calculateWindow()
        ├─ piece.poll(credentials, streamName, window)  →  PollPage[]
        ├─ CursorManagerService.trackHighWaterMark()
        └─ checkpoint  →  public.sync_cursors  (keyed by stitch_id + stream_name)
                                          │
[L1]  inbound_gateway  +  Inbound_Queue  (SQS / BullMQ)
                                          │
[L2]  ReplicaService  (UPSERT — deduplicates safety-buffer re-fetches)
        └─  ws_{id}.sync_cursor  (L2 → L3 replication state)
                                          │
[L3]  NormalizationService
                                          │
[L4]  FanOutService  (syncConditions + field_mapping)
                                          │
[L5]  DeliveryService  →  Destination SaaS API
                                          │
[L6]  GEM write  +  sync_log audit
```

---

## 14. Task Mapping (Updated)

| Old Task | Updated Description |
| --- | --- |
| T049 | Docker-compose: add `windmill_server`, `windmill_worker`, `windmill_init` services; add `scripts/create-windmill-db.sh`; add Windmill env vars to `.env.example` |
| T050 | `WindmillClient` HTTP adapter + `StubWindmillClient` + `intervalToCron` utility |
| T029 | `SchedulerModule` + `SchedulerService` backed by `WindmillClient` |
| T046 | DB migration `0013_sync_cursors`: generate SQL; also drop `ds_project_code` from organization in same migration |
| T047 | `packages/engine/` — `CursorManagerService` (unchanged from original design) |
| T048 | Admin cursor reset endpoints (unchanged) |

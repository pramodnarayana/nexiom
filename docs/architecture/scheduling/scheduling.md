# Architecture: Stateful Sync — DolphinScheduler + Cursor Manager

## Overview

The FluxNex sync pipeline uses two complementary systems:

| System | Role |
| --- | --- |
| **Apache DolphinScheduler** | Master Clock — owns cron schedules, multi-tenant isolation, retry DAGs, failure alerts, and visual monitoring |
| **CursorManagerService** | Memory — owns incremental state, polling windows, high-water marks, and crash-safe checkpointing |

DolphinScheduler decides **when** to poll. CursorManagerService decides **where to start** and **where to stop**.

---

## 1. Core Philosophy: The Bookmark Model

Instead of a naive `updated_at` query, sync state is modelled as a **Singer-style Bookmark** JSON document. A single stitch can track multiple independent data streams (e.g. `Account`, `rtms__Load__c`, `Invoice`) simultaneously without losing its place in any of them.

The bookmark includes a `replication_key_type` discriminator so `CursorManagerService` knows how to compare values safely across connectors that use timestamps, integer sequences, or opaque vendor cursors.

---

## 2. System Architecture

### 2A. Apache DolphinScheduler — The Master Clock

DolphinScheduler is deployed as a sidecar service alongside the NestJS API. It acts as the sole authority on **when** a poll run fires.

**Tenant Isolation Model:**

| DolphinScheduler Concept | FluxNex Mapping |
| --- | --- |
| Project | `orgId` — one DS project per tenant |
| Process Definition | Stitch — one process per `stitchId` |
| HTTP Task | The poll action — calls `POST /internal/scheduler/execute-stitch` |
| Schedule (cron) | Derived from `syncIntervalMinutes` (see §2B) |
| Worker Group | `PRODUCTION` or `SANDBOX` (env isolation) |
| Alert Plugin | Routes failure notifications → Exception Center |

**What DolphinScheduler provides for free:**

- Visual DAG editor and run history
- Built-in retry with configurable backoff per process definition
- Timeout enforcement (kills hung workers)
- Multi-tenant process namespacing (projects)
- Audit log of every run with status, duration, and error detail
- Manual trigger via UI or REST API

### 2B. Interval → Cron Mapping

| `syncIntervalMinutes` | Cron Expression (Quartz) |
| --- | --- |
| 30 | `0 0/30 * * * ?` |
| 60 | `0 0 * * * ?` |
| 120 | `0 0 0/2 * * ?` |
| 240 | `0 0 0/4 * * ?` |
| 360 | `0 0 0/6 * * ?` |
| 720 | `0 0 0/12 * * ?` |
| 1440 | `0 0 0 * * ?` |

### 2C. CursorManagerService — The Memory

Every time DolphinScheduler fires, it calls the NestJS `/internal/scheduler/execute-stitch` endpoint. The `SchedulerWorker` then interacts with `CursorManagerService` in three sequential phases:

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
DolphinScheduler (cron fires)
    │
    │  POST /internal/scheduler/execute-stitch  { stitchId }
    │  Authorization: Bearer <DS_INTERNAL_SECRET>
    │
    ▼
NestJS  SchedulerWorker
    │
    ├─ 0. Validate Bearer token against DS_INTERNAL_SECRET
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
    ├─ 6. For each page from piece.poll(credentials, window, nextPageCursor):
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
```

DolphinScheduler records the HTTP response status. On non-2xx it marks the run `FAILURE` and applies the retry DAG (configurable backoff per process definition).

**`SKIPPED` returns HTTP 200** — a skipped run means the previous run is still active. DS must not retry a skipped run; returning 2xx prevents the retry DAG from firing.

**Crash recovery:** If the worker dies mid-pagination, `bookmark.offset` holds the last persisted `nextPageCursor` and `currently_syncing` is set. On the next DS-triggered run, step 4 detects the interrupted stream and resumes from the saved page cursor instead of restarting from the high-water mark.

---

## 3. DolphinScheduler Lifecycle — Stitch CRUD

Every stitch create/update/delete operation must mirror to DolphinScheduler via the `DolphinSchedulerClient`.

**DS Project Code Storage:** DS assigns numeric project codes at creation time. `SchedulerService` stores the code in `organization.ds_project_code` (nullable `BIGINT`) when the org's first stitch is registered. Subsequent stitch registrations read the stored code rather than calling the DS API. `NULL` means no DS project exists yet for that org.

| Stitch Action | DolphinScheduler Action |
| --- | --- |
| `POST /stitches` (first stitch for org, `scheduleEnabled=true`) | Create DS project → store `ds_project_code` on org → Create process definition → Create schedule → Online |
| `POST /stitches` (subsequent stitch, `scheduleEnabled=true`) | Read `org.ds_project_code` → Create process definition → Create schedule → Online |
| `PATCH /stitches/:id/schedule` (update interval) | Update schedule cron → Re-online |
| `PATCH /stitches/:id/schedule` (`scheduleEnabled=false`) | Offline schedule |
| `POST /stitches/:id/schedule/trigger` | One-shot process instance via DS REST API |
| `DELETE /stitches/:id` | Offline + delete process definition + delete schedule |
| `DELETE /organization/:id` (org offboarding) | Offline all process definitions → Delete DS project → Clear `org.ds_project_code` |

---

## 4. Database Schema — `public.sync_cursors`

Lives in the **shared control-plane schema**. The SchedulerWorker reads and writes this table directly without switching `search_path`.

| Column | Type | Description |
| --- | --- | --- |
| `id` | `UUID` | Primary key |
| `stitch_id` | `UUID` | FK → `integration_stitch.id` ON DELETE CASCADE |
| `stream_name` | `VARCHAR(200)` | Object/stream name (e.g. `Account`, `rtms__Load__c`) |
| `state_document` | `JSONB` | Singer-style bookmark payload (see §5). Default: `{"bookmarks":{}}` |
| `updated_at` | `TIMESTAMPTZ` | Last successful checkpoint timestamp |

**Unique index:** `(stitch_id, stream_name)` — one row per stream **per stitch**. Stitches that share the same source connection + stream name each have their own independent cursor row so advancing one never affects the other.

> **Why `stitch_id` not `connection_id`:** Using `connection_id` as the key would cause two stitches sharing the same Salesforce connection and polling the same `Account` stream to collide on a single cursor row. Stitch A advancing its high-water mark would silently suppress records for Stitch B on its next run.

**Distinct from `ws_{id}.sync_cursor`**: the per-tenant workspace `sync_cursor` table (created by the `REPLICA_ACTIVE` schema plan, T026) tracks L2 replication state. `public.sync_cursors` tracks what has been fetched from the **source** SaaS API.

---

## 5. Singer-Style State Payload (JSONB)

```json
{
  "bookmarks": {
    "rtms__Load__c": {
      "replication_key": "SystemModstamp",
      "replication_key_value": "2026-03-22T09:45:00.000Z",
      "replication_key_type": "timestamp",
      "offset": {}
    },
    "Account": {
      "replication_key": "LastModifiedDate",
      "replication_key_value": "2026-03-21T18:30:00.000Z",
      "replication_key_type": "timestamp",
      "offset": {}
    }
  },
  "versions": {
    "rtms__Load__c": 1,
    "Account": 1
  },
  "currently_syncing": null
}
```

**Field semantics (aligned with singer-python `state.py` conventions):**

- `bookmarks.{stream}.replication_key` — the field name used as the replication key. Stored alongside the value so the bookmark is self-describing without needing to re-read the catalog on every run.
- `bookmarks.{stream}.replication_key_value` — the highest value successfully checkpointed.
- `bookmarks.{stream}.replication_key_type` — FluxNex extension (not in Singer base spec). Tells `CursorManagerService` how to compare and format the value (`timestamp` / `numeric` / `opaque`).
- `bookmarks.{stream}.offset` — Singer pagination offset. Persisted after each page so a crash on page N restarts at page N, not at the high-water mark. Cleared when the run completes successfully.
- `versions.{stream}` — Singer ACTIVATE_VERSION semantics. Incremented when a full-table reload is triggered (e.g. schema change, admin cursor reset). Stored at the top level, not inside the bookmark, per singer-python convention.
- `currently_syncing` — the stream currently being polled. Set at the start of a stream's poll run; cleared on completion. Used by crash-recovery logic to resume the interrupted stream first on the next run.

---

## 6. TypeScript Interfaces

```typescript
// packages/connectors/src/framework/piece.ts
// (PollWindow, PollRecord, PollPage, StreamDescriptor defined here — connectors is a leaf package
//  with no engine dependency, so engine can safely import these types)

export type ReplicationKeyType = 'timestamp' | 'numeric' | 'opaque';

// StreamDescriptor is a discriminated union so TypeScript enforces at compile time:
//   INCREMENTAL → replicationKey + replicationKeyType required
//   FULL_TABLE | LOG_BASED → replicationKey/replicationKeyType forbidden
// keyProperties typed as [string, ...string[]] (non-empty) so L2 always has
// a conflict target for UPSERT deduplication.

export interface PollWindow {
  lowerBound: string;
  upperBound: string;
  replicationKeyType: ReplicationKeyType;
}

export interface PollRecord {
  data: Record<string, unknown>;
  replicationKey: string;
  replicationKeyValue: string | number;
}

export interface PollPage {
  streamName: string;
  records: PollRecord[];
  nextPageCursor?: string;
}
```

```typescript
// packages/engine/src/state/cursor-manager.types.ts
// ReplicationKeyType, PollWindow, PollRecord, PollPage, StreamDescriptor
// are imported from @nexiom/connectors/framework (defined alongside Piece).

import type { ReplicationKeyType, StreamDescriptor } from '@nexiom/connectors/framework';
export type { ReplicationKeyType, StreamDescriptor };

export interface StreamBookmark {
  /** Field name used as the replication key (e.g. 'SystemModstamp'). */
  replication_key: string;
  /** Highest value successfully checkpointed. */
  replication_key_value: string | number;
  /**
   * FluxNex extension — not in Singer base spec.
   * Tells CursorManagerService how to compare and window the value.
   */
  replication_key_type: ReplicationKeyType;
  /**
   * Singer pagination offset — persisted per page so a crash resumes at page N,
   * not from the high-water mark. Cleared after a successful full run.
   * Shape is connector-specific (e.g. { cursor: "abc123" }).
   */
  offset?: Record<string, unknown>;
}

export interface SyncStateDocument {
  bookmarks: Record<string, StreamBookmark>;
  /**
   * Singer ACTIVATE_VERSION tracking — stored at the top level, not inside bookmarks,
   * per singer-python state.py convention.
   * Incremented when a full-table reload is triggered.
   */
  versions: Record<string, number>;
  /**
   * The stream currently being polled. Set before polling starts; cleared on success.
   * On crash recovery the SchedulerWorker resumes this stream first.
   */
  currently_syncing: string | null;
}

/** Payload DolphinScheduler sends to POST /internal/scheduler/execute-stitch */
export interface ExecuteStitchPayload {
  stitchId: string;
}

/** Per-stream result stats */
export interface StreamResult {
  streamName: string;
  recordsIngested: number;
  newHighWaterMark?: string;
}

/** Response returned to DolphinScheduler — non-2xx triggers the DS retry DAG */
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
   *
   * `catalog` is required so we know the replication key type on the first run
   * (before any bookmark exists). SchedulerWorker calls piece.describeStreams()
   * once per execution and passes the matching StreamDescriptor here.
   *
   * Behaviour per replication_key_type:
   *   timestamp — subtract safety buffer from the last cursor (ISO-8601 arithmetic).
   *   numeric   — use the raw value as lowerBound; no buffer applied.
   *   opaque    — pass the raw token through unchanged as lowerBound.
   *
   * Returns epoch lower bound on first run (no bookmark = full refresh).
   * For numeric streams, returns '0' on first run (not an ISO string).
   */
  calculateWindow(
    bookmark: StreamBookmark | undefined,
    catalog: StreamDescriptor,
  ): PollWindow {
    const upperBound = dayjs().toISOString();
    // Prefer the persisted type; fall back to catalog declaration.
    const replicationKeyType: ReplicationKeyType =
      bookmark?.replication_key_type ?? catalog.replicationKeyType ?? 'timestamp';

    if (!bookmark) {
      const lowerBound = replicationKeyType === 'numeric' ? '0' : '1970-01-01T00:00:00.000Z';
      return { lowerBound, upperBound, replicationKeyType };
    }

    let lowerBound: string;
    if (replicationKeyType === 'timestamp') {
      const parsed = dayjs(bookmark.replication_key_value as string);
      if (!parsed.isValid()) {
        this.logger.warn(
          `Invalid timestamp cursor "${bookmark.replication_key_value}" for key "${bookmark.replication_key}". ` +
          `Falling back to epoch for full refresh.`,
        );
        lowerBound = '1970-01-01T00:00:00.000Z';
      } else {
        lowerBound = parsed.subtract(this.safetyBufferMinutes, 'minute').toISOString();
      }
    } else {
      // numeric or opaque — use raw value, no date arithmetic
      lowerBound = String(bookmark.replication_key_value);
    }

    return { lowerBound, upperBound, replicationKeyType };
  }

  /**
   * Phase B — Advance the High-Water Mark from a batch of records.
   * Returns the new maximum replication_key_value seen in this page.
   * Value is held in memory; the caller persists it in Phase C.
   *
   * Comparison is type-aware:
   *   timestamp — lexicographic (safe for ISO-8601)
   *   numeric   — numeric (prevents "999" > "10000" false-positive)
   *   opaque    — last-write-wins (connector manages its own cursor semantics)
   */
  trackHighWaterMark(
    records: PollRecord[],
    currentMax: string,
    replicationKeyType: ReplicationKeyType,
  ): string {
    if (replicationKeyType === 'opaque') {
      // For opaque cursors the connector controls cursor semantics;
      // return the last record's value unconditionally.
      if (records.length > 0) {
        return String(records[records.length - 1]!.replicationKeyValue);
      }
      return currentMax;
    }

    let newMax = currentMax;
    for (const record of records) {
      const value = record.replicationKeyValue;
      if (replicationKeyType === 'numeric') {
        if (Number(value) > Number(newMax)) newMax = String(value);
      } else {
        // timestamp — lexicographic comparison is safe for ISO-8601
        if (String(value) > newMax) newMax = String(value);
      }
    }
    return newMax;
  }
}
```

---

## 8. DolphinSchedulerClient

The `DolphinSchedulerClient` wraps the DS REST API. It is injected into `SchedulerModule` and called from `StitchesController` on every schedule lifecycle event.

```typescript
// apps/api/src/modules/scheduler/dolphin-scheduler.client.ts

export interface DsProjectInfo {
  /** DS-assigned numeric project code. Persisted to organization.ds_project_code. */
  code: number;
}

export interface DsProcessDefinition {
  code: number;   // DS internal identifier
  name: string;   // stitch ID
  scheduleId?: number;
}

export abstract class DolphinSchedulerClient {
  /** Create a DS project for an org. Returns the DS-assigned numeric project code. */
  abstract createProject(orgId: string): Promise<DsProjectInfo>;

  /** Register a new stitch as a DS process definition with HTTP task + cron. */
  abstract registerStitch(stitchId: string, dsProjectCode: number, cron: string): Promise<DsProcessDefinition>;

  /** Update the cron expression for an existing stitch schedule. */
  abstract updateSchedule(stitchId: string, dsProjectCode: number, cron: string): Promise<void>;

  /** Activate (online) the schedule — runs fire from DS. */
  abstract enableSchedule(stitchId: string, dsProjectCode: number): Promise<void>;

  /** Pause (offline) the schedule — runs are suppressed. */
  abstract disableSchedule(stitchId: string, dsProjectCode: number): Promise<void>;

  /** Fire a one-shot run immediately via DS REST API (manual trigger). */
  abstract triggerOnce(stitchId: string, dsProjectCode: number): Promise<void>;

  /** Offline + remove the process definition and schedule when a stitch is deleted. */
  abstract deregisterStitch(stitchId: string, dsProjectCode: number): Promise<void>;

  /** Offline all process definitions and delete the DS project on org offboarding. */
  abstract deleteProject(dsProjectCode: number): Promise<void>;
}
```

---

## 9. Endpoint Security — `/internal/scheduler/execute-stitch`

This endpoint must **not** be exposed on the public API port. Two layers of protection are required:

1. **Network isolation:** DS and NestJS share an internal Docker network. The endpoint is bound to the internal port only and is not reachable from outside the container network.
2. **Shared secret guard:** DS injects `Authorization: Bearer <DS_INTERNAL_SECRET>` on every HTTP Task call. The NestJS guard validates this header before the handler runs. The secret is set via the `DS_INTERNAL_SECRET` env var (minimum 32 bytes, randomly generated per deployment).

If the Authorization header is missing or invalid, the endpoint returns `401`. DS records `FAILURE` and the retry DAG fires.

---

## 10. Enterprise Edge Case Handling

### 10.1 Safety Buffer Duplicates

DolphinScheduler intentionally re-fetches the last N minutes of records on each run.

**Resolution:** L2 (`ReplicaService`) uses `INSERT ... ON CONFLICT (entity_type, source_id) DO UPDATE` — safety-buffer duplicates are silently merged.

### 10.2 Pagination Crash Recovery

DolphinScheduler enforces a per-process timeout. If the poll times out on page 50 of 100, the cursor is not advanced.

**Resolution:** Intermediate checkpoints every `CURSOR_CHECKPOINT_INTERVAL` pages (default: 10). A timeout on page 50 loses at most 10 pages of progress, not 50.

### 10.3 Concurrent Poll Prevention

DolphinScheduler prevents concurrent runs via the **Serial Wait** execution strategy on the process definition (`executionType: SERIAL_WAIT`). As a secondary guard, the SchedulerWorker acquires Redis lock `lock:poll:{stitchId}:{streamName}` and returns `SKIPPED` (HTTP 200) if unavailable.

> DS property: set `executionType` to `SERIAL_WAIT` or `SERIAL_DISCARD` on the process definition — not `maximumParallelism`, which does not exist as a DS property.

### 10.4 Stale Cursor Detection

If `sync_cursors.updated_at` age exceeds `2 × syncIntervalMinutes`, the cursor is stale (zero records from source, suspended OAuth, or misconfigured replication key). DolphinScheduler's run history will show repeated `SUCCESS` with `recordsIngested=0`.

**Resolution:** SchedulerWorker emits a `cursor_stale` Prometheus counter. The Exception Center monitors `recordsIngested=0` streaks and surfaces actionable alerts.

### 10.5 Full Refresh Trigger

`DELETE /admin/stitches/:id/cursor/:streamName` removes the `sync_cursors` row. The next DS-triggered run detects no bookmark and falls back to the epoch lower bound. Alternatively, DolphinScheduler's manual trigger can be paired with a pre-run cursor reset via a preceding HTTP task in the DAG.

### 10.6 DS Failure → Retry DAG

If the `/internal/scheduler/execute-stitch` endpoint returns a non-2xx response, DolphinScheduler marks the run `FAILURE` and executes the retry DAG (configurable per process definition: e.g. 3 retries with 5-min backoff). After all retries are exhausted, the DS alert plugin fires a notification → Exception Center.

---

## 11. Infrastructure — DolphinScheduler Deployment

DolphinScheduler 3.x runs as four Docker services sharing a PostgreSQL backing store (reusing the existing Nexiom PostgreSQL instance with a dedicated `dolphinscheduler` database).

```yaml
# docker-compose additions (excerpt)
ds-master:
  image: apache/dolphinscheduler-master:3.2.2
  environment:
    - DATABASE_HOST=postgres
    - DATABASE_NAME=dolphinscheduler
    - REGISTRY_TYPE=zookeeper
  depends_on: [postgres, zookeeper]

ds-worker:
  image: apache/dolphinscheduler-worker:3.2.2
  environment:
    - DATABASE_HOST=postgres
    - DATABASE_NAME=dolphinscheduler
    - WORKER_GROUPS=default,production,sandbox
  depends_on: [ds-master]

ds-api:
  image: apache/dolphinscheduler-api:3.2.2
  ports: ["12345:12345"]
  environment:
    - DATABASE_HOST=postgres
    - DATABASE_NAME=dolphinscheduler
  depends_on: [ds-master]

ds-alert:
  image: apache/dolphinscheduler-alert-server:3.2.2
  depends_on: [ds-master]
```

**Environment variables:**

| Variable | Description |
| --- | --- |
| `DS_API_URL` | DolphinScheduler API base URL (e.g. `http://ds-api:12345/dolphinscheduler`) |
| `DS_API_TOKEN` | DS admin API token |
| `DS_NESTJS_API_URL` | NestJS base URL that DS HTTP Tasks call into (e.g. `http://api:3000`) |
| `DS_INTERNAL_SECRET` | Shared secret injected by DS into every HTTP Task `Authorization` header |
| `DS_DEFAULT_PROJECT_CODE` | Fallback project code for single-tenant dev environments |

---

## 12. Integration with the 6-Layer Pipeline

```text
[DolphinScheduler]  cron fires  →  POST /internal/scheduler/execute-stitch
                                          │  Bearer <DS_INTERNAL_SECRET>
[L0]  SchedulerWorker  (NestJS)
        ├─ stitchId → srcConnectionId + sourceObject  (DB lookup)
        ├─ CursorManagerService.calculateWindow()
        ├─ piece.poll(credentials, window)  →  PollPage[]
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

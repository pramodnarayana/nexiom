# Nexiom Platform Architecture

> Living document. Update as decisions evolve.  
> Last updated: 2026-04-17

---

## Table of Contents

1. [Sync Pipeline — The 6 Layers](#1-sync-pipeline--the-6-layers)
2. [Database — Per-Connection Tenant Schemas](#2-database--per-connection-tenant-schemas)
3. [Canonical Data Model](#3-canonical-data-model)
4. [Code Organisation — Platform vs Application](#4-code-organisation--platform-vs-application)
5. [Normalizer Registry Pattern](#5-normalizer-registry-pattern)
6. [Stitch Multi-Object Field Mapping](#6-stitch-multi-object-field-mapping)
7. [Sync Condition Evaluation (OR/AND)](#7-sync-condition-evaluation-orand)
8. [Frontend — MappingCanvas & Field Refresh](#8-frontend--mappingcanvas--field-refresh)
9. [Dev Workflow — Package Watch Mode](#9-dev-workflow--package-watch-mode)
10. [Revenova Integration — End-to-End Example](#10-revenova-integration--end-to-end-example)
11. [Custom Mapping — Configuration vs GitOps Sharding](#11-custom-mapping--configuration-vs-gitops-sharding)

---

## 1. Sync Pipeline — The 6 Layers

Every record that enters Nexiom flows through 6 layers. Each layer has a single responsibility and writes to the next via a transactional outbox.

```
Webhook / Poll
      │
      ▼
L1  inbound_gateway        Raw payload — immutable "source evidence"
      │
      ▼
L2  replica_entity         Parsed, one row per entity, deduplicated by
                           (connection_id, entity_type, source_id)
      │
      ▼
L3  normalized_entity      Converted to canonical type
                           e.g. TMS_CARRIER, TMS_CUSTOMER, ACCT_INVOICE
      │
      ▼
L4  Fan-out (in-memory)    Evaluates all matching stitches.
                           Joins related normalized_entity rows for
                           multi-object mapping. Applies field mappings.
      │
      ▼
L5  outbound_gateway       Mapped payload written to destination API
      │
      ▼
L6  Response & retry       Vendor API response stored, retry on failure
```

**Outbox pattern** is used between L1→L2, L2→L3, and L4→L5 to guarantee at-least-once delivery even on process crash.

**Sync log** records one row per layer transition per trace — powers the trace/exception dashboard.

---

## 2. Database — Per-Connection Tenant Schemas

All pipeline tables (L1–L6) live in **isolated per-connection Postgres schemas**, not in the shared `public` schema.

```
public schema:
  app_connection              ← connection registry
  integration_stitch          ← stitch configuration
  field_mapping               ← mapping rules per source canonical
  global_entity_map           ← source-ID ↔ dest-ID cross-reference
  connector_object_profiles   ← cached field metadata

ws_sf_abc123 schema:          ← provisioned for Salesforce connection "abc123"
  inbound_gateway
  replica_entity
  normalized_entity
  outbound_gateway
  sync_log / sync_cursor
  replica_outbox / normalized_outbox / delivery_outbox

ws_qb_xyz456 schema:          ← provisioned for QB connection "xyz456"
  (same tables)
```

**Why isolated schemas:** Data isolation, compliance, per-tenant performance tuning, and geo-location of tenant data without cross-tenant query risk.

**Schema naming rule:** `ws_[a-z0-9_]+` — enforced by `assertValidSchemaName()` before any `pgSchema()` call to prevent SQL injection.

---

## 3. Canonical Data Model

### Design principle

`replica_entity` stores raw source fields.  
`normalized_entity` stores **the same row structure** but with standardised platform-defined field names.

Both tables: same shape (one row per entity, discriminated by type). **Never merged at storage level.** Cross-object joins happen at L4 in-memory only.

```
replica_entity row:                  normalized_entity row:
  entity_type = 'Account'              canonical_type = 'TMS_CARRIER'
  data = {                             data = {
    BillingStreet: "123 Main",           billing_street: "123 Main",
    TMS_Type__c: "Carrier",              billing_city: "Hartford",
    Phone: "860-893-4389"                phone: "860-893-4389",
  }                                    }
```

### TMS canonical types

```typescript
TMS_CARRIER = {
  name: string,
  billing_street: string,
  billing_city: string,
  billing_state: string,
  billing_postal_code: string,
  billing_country: string,
  phone: string,
  email: string,
  tax_id: string,
  // NOTE: mc_number is NOT here — it belongs to TMS_TRANSPORTATION_PROFILE
}

TMS_CUSTOMER = {
  name: string,
  billing_street: string,
  billing_city: string,
  billing_state: string,
  billing_postal_code: string,
  billing_country: string,
  phone: string,
  email: string,
  credit_limit: number,
}

TMS_TRANSPORTATION_PROFILE = {
  mc_number: string,              // MC_Number__c
  dot_number: string,             // DOT_Number__c
  carrier_account_id: string,     // Account__c → links to TMS_CARRIER row by source_id
  remit_to_account_id: string,    // Remit_To__c → links to ANOTHER TMS_CARRIER row
  // NOTE: remit billing address is NOT stored here.
  // At L4, the TMS_CARRIER row for remit_to_account_id is looked up and its
  // billing_* fields are mapped to QB BillAddr.
}
```

### Accounting canonical types

```typescript
ACCT_VENDOR   = { name, billing_*, phone, email, tax_id }
ACCT_CUSTOMER = { name, billing_*, phone, email, credit_limit }
ACCT_INVOICE  = { invoice_number, amount, due_date, customer_id }
ACCT_BILL     = { bill_number, amount, due_date, vendor_id }
```

### Cross-object resolution at L4

When the fan-out engine processes a TMS_CARRIER record for a QB Vendor stitch:

1. Read `TMS_CARRIER` → DisplayName, Phone, Email
2. Query `TMS_TRANSPORTATION_PROFILE` where `carrier_account_id = carrier.source_id` → mc_number → QB GivenName
3. Query `TMS_CARRIER` where `source_id = tp.remit_to_account_id` → billing_* → QB BillAddr.*

**No Salesforce API calls at L4.** All data is already stored from when those records were ingested.

---

## 4. Code Organisation — Platform vs Application

### The fundamental boundary

| Layer | What it knows | Access |
|---|---|---|
| **Platform** | HOW to connect — auth, API calls, HTTP | Core team only |
| **Application** | WHAT the data means — normalizers, canonical types | Core team + contractors |

**Contractor onboarding example:** A McLeod TMS specialist gets access to `packages/pieces/application/mcleod/` only. They write normalizers without ever seeing authentication code, the queue, or the database schema.

### Directory structure

```
packages/pieces/
├── platform/                    ← RESTRICTED — core IP, internal only
│   ├── framework/               ← Piece, NormalizerResult, FieldDescriptor interfaces
│   ├── registry/                ← metadata discovery, Redis/DB caching
│   ├── salesforce/              ← OAuth, REST API, describe*, executeFetch, executeFind
│   │                               normalize() always returns null (pure platform)
│   └── quickbooks/              ← OAuth, REST API, executeAction
│                                   QB is write-only — no inbound normalizers
│
└── application/                 ← OPEN — contractor/outsource friendly
    ├── canonical/               ← shared canonical type definitions
    │   ├── tms/                 ← TMS_CARRIER, TMS_CUSTOMER, TMS_TRANSPORTATION_PROFILE
    │   ├── accounting/          ← ACCT_VENDOR, ACCT_INVOICE, ACCT_BILL
    │   └── hr/                  ← HR_EMPLOYEE (future)
    ├── revenova/                ← Revenova TMS (Salesforce-based)
    │   └── src/normalizers/
    │       ├── account.normalizer.ts
    │       ├── transportation-profile.normalizer.ts
    │       └── index.ts
    ├── mcleod/                  ← McLeod TMS (own API — dual registration with platform/mcleod)
    └── <next-app>/

engine/sync/
├── platform/                   ← RESTRICTED
│   └── core/
│       ├── evaluator.ts         ← evaluateConditions (AND/OR)
│       └── path-utils/          ← getNestedValue / setNestedValue
└── application/                ← OPEN
    ├── mapping/                 ← MappingEngine
    └── canonical/               ← mirrors packages/pieces/application/canonical
```

### Dual registration for own-platform apps (McLeod, Samsara)

For apps that own their API (not Salesforce-based):

```
packages/pieces/platform/mcleod/    ← auth, API client (no normalizers)
packages/pieces/application/mcleod/ ← normalizers (no auth code)
```

Two packages, same app name. No exceptions to the principle — platform is always pure.

### Dependency rule

```
application  →  platform  (OK: reads NormalizerResult interface from framework)
platform    →  application  (NEVER: zero business logic in platform code)
```

---

## 5. Normalizer Registry Pattern

### Key design decisions

1. **One function per object type** — no if-chains. Each object has its own normalizer file.
2. **Registry keyed by (appProfile, objectType)** — NOT (platform, objectType). Two companies can use Salesforce with different data models.
3. **`appProfile` comes from `app_connection.metadata.app_profile`** — set when the customer registers their connection (e.g. `"revenova"`).

### Registration

```typescript
// packages/pieces/application/revenova/src/normalizers/index.ts
import { registerNormalizer } from '@nexiom/piece-framework';

registerNormalizer('revenova', 'Account',                    normalizeAccount);
registerNormalizer('revenova', 'TransportationProfile__c',   normalizeTransportationProfile);
registerNormalizer('revenova', 'VendorInvoice__c',           normalizeVendorInvoice);
registerNormalizer('revenova', 'Invoice__c',                 normalizeCustomerInvoice);
```

### Worker call (no if-chains)

```typescript
const normalizer = getNormalizer(appProfile, objectType);
const result = normalizer?.(rawData) ?? null;
// null → Shipper/Consignee, or unrecognised object type → skip L3
```

### Example normalizer

```typescript
// account.normalizer.ts — pure function, no platform/infrastructure imports
export function normalizeAccount(raw: Record<string, unknown>): NormalizedResult | null {
  const tmsType = raw['TMS_Type__c'] as string;

  if (tmsType === 'Carrier' || tmsType === 'Factoring') {
    return {
      canonicalType: 'TMS_CARRIER',
      data: {
        name:                raw['Name'],
        billing_street:      raw['BillingStreet'],
        billing_city:        raw['BillingCity'],
        billing_state:       raw['BillingState'],
        billing_postal_code: raw['BillingPostalCode'],
        billing_country:     raw['BillingCountry'],
        phone:               raw['Phone'],
        email:               raw['PersonEmail'],
        tax_id:              raw['TaxId__c'],
      }
    };
  }

  if (tmsType === 'Customer') {
    return { canonicalType: 'TMS_CUSTOMER', data: { /* ... */ } };
  }

  return null; // Shipper/Consignee — not synced
}
```

---

## 6. Stitch Multi-Object Field Mapping

### Problem

A single QB Vendor record requires fields from three Salesforce objects:
- `Account` → DisplayName, Phone, Email
- `TransportationProfile__c` → GivenName (MC Number)
- `Account` (Remit To) → BillAddr.*

### Solution

Each stitch supports **multiple source canonicals**, each with their own mapping rules. The UI shows one tab per canonical.

### Frontend (MultiObjectMappingEditor)

```
Stitch A: Account → QB Vendor
│
├── [Tab: TMS_CARRIER]  (primary — has sync conditions)
│   ├── name → DisplayName
│   ├── phone → PrimaryPhone.FreeFormNumber
│   └── email → PrimaryEmailAddr
│   Sync Conditions: TMS_Type__c = Carrier OR TMS_Type__c = Factoring
│
└── [Tab: TMS_TRANSPORTATION_PROFILE]  (secondary — no sync conditions)
    ├── mc_number → GivenName
    └── [remit_to resolved at L4] → BillAddr.*
```

Secondary tabs have `hideConditions=true`. Sync conditions only apply to the primary canonical.

### Backend schema

```sql
field_mapping:
  stitch_id        uuid
  source_canonical varchar(100)   -- 'TMS_CARRIER' or 'TMS_TRANSPORTATION_PROFILE'
  mapping_rules    jsonb          -- [{ src, dest, transform }]
  UNIQUE (stitch_id, source_canonical)
```

### Backend — atomic save

On save, the API:
1. Computes `toDelete` = canonicals in DB missing from the new UI state
2. Runs all upserts + deletes via `Promise.all` (parallelised, atomic intent)
3. Updates sync conditions on the primary canonical's stitch row only

---

## 7. Sync Condition Evaluation (OR/AND)

### Use case

Carrier AND Factoring accounts both sync to QB Vendor:
`TMS_Type__c = Carrier OR TMS_Type__c = Factoring`

### Logic model

```
- logic = 'AND' (or omitted): condition is AND-chained within the current group
- logic = 'OR': ends current group, starts a new OR-group
- Stitch fires if ANY group evaluates to true
```

### Examples

```
[{ field:'TMS_Type__c', op:'eq', value:'Carrier', logic:'AND' },
 { field:'TMS_Type__c', op:'eq', value:'Factoring', logic:'OR' }]
→ (TMS_Type=Carrier) OR (TMS_Type=Factoring) ✓

[{ field:'Status', op:'eq', value:'Active', logic:'AND' },
 { field:'Region', op:'eq', value:'US', logic:'AND' }]
→ Status=Active AND Region=US  (classic AND-only, unchanged behaviour) ✓
```

### Implementation

`engine/sync/platform/core/src/evaluator.ts` — `evaluateConditions(conditions, data)`

Also supports **dot-notation field paths** via `getNestedValue`: `Account.BillingCity` works.

---

## 8. Frontend — MappingCanvas & Field Refresh

### Field loading

On mount, `MappingCanvas` calls `listFields()` for both source and destination connections in parallel.

### Cache layers (backend)

```
Browser → Redis (5 min TTL) → Postgres (5 min TTL) → Live connector API
```

### Cache bypass — the ↺ button

Clicking ↺ in MappingCanvas calls `listFields(connectionId, objectName, refresh=true)`.

This sends: `GET /api/stitches/metadata/:id/objects/:name/fields?refresh=true&_t=1234567890`

| Parameter | Purpose |
|---|---|
| `?refresh=true` | Backend deletes Redis key + skips Postgres cache → fetches from connector |
| `&_t=Date.now()` | Defeats **browser HTTP cache** — prevents `304 Not Modified` returning stale fields |

**Why `_t` is necessary:** Without it, the browser sends `If-None-Match` on the same URL and gets `304`. The new fields never appear even after the server cache is busted.

### Static connectors (QB) require a package rebuild

Salesforce discovers fields live via the Salesforce API — cache bust is sufficient.  
QuickBooks uses a `QB_FIELDS` constant **compiled into `dist/`** — editing source alone is not enough.

```bash
# After editing QB_FIELDS in source:
node node_modules/.bin/tsc -p packages/pieces/platform/quickbooks/tsconfig.lib.json
touch apps/api/src/modules/stitches/stitches-metadata.controller.ts  # trigger HMR
```

This is automated going forward via `--watch` mode in `dev:light`.

---

## 9. Dev Workflow — Package Watch Mode

### Problem

`dev:light` NestJS HMR watches `apps/api/src/**` only. Changes to connector packages require a manual `tsc` rebuild.

### Solution

All piece packages expose a `dev` script running `tsc --watch`. `dev:light` runs all of them in parallel.

```json
// root package.json
"dev:light": "dotenv -e .env -- env QUEUE_ENABLED=false pnpm --parallel
  --filter=api --filter=web --filter=@nexiom/ai-engine
  --filter=@nexiom/piece-quickbooks
  --filter=@nexiom/piece-salesforce
  --filter=@nexiom/piece-registry
  dev"
```

```json
// packages/pieces/platform/<name>/package.json
"scripts": {
  "dev":   "tsc -p tsconfig.lib.json --watch --preserveWatchOutput",
  "build": "tsc -p tsconfig.lib.json"
}
```

`--preserveWatchOutput`: prevents tsc from clearing the terminal, keeping all service logs readable.

**Flow:** Edit connector source → `tsc --watch` recompiles to `dist/` in ~200ms → NestJS HMR detects `dist/` change → hot-reloads module → no manual step needed.

---

## 10. Revenova Integration — End-to-End Example

### The four sync requirements

| Stitch | Source (Salesforce) | Condition | Destination (QB) |
|---|---|---|---|
| A | Account | TMS_Type = **Carrier** OR **Factoring** | Vendor |
| B | Account | TMS_Type = **Customer** | Customer |
| C | VendorInvoice__c | none | Bill |
| D | Invoice__c | none | Invoice |
| — | Account (Shipper/Consignee) | — | **Not synced** |

### Stitch A — field mapping detail

**Tab 1: TMS_CARRIER (primary)**

| Source canonical field | → | QB Vendor field |
|---|---|---|
| name | | DisplayName |
| phone | | PrimaryPhone.FreeFormNumber |
| email | | PrimaryEmailAddr |

**Tab 2: TMS_TRANSPORTATION_PROFILE (secondary)**

| Source canonical field | → | QB Vendor field |
|---|---|---|
| mc_number | | GivenName |
| _(resolved TMS_CARRIER.billing_street from remit_to_account_id)_ | | BillAddr.Line1 |
| _(resolved TMS_CARRIER.billing_city)_ | | BillAddr.City |
| _(resolved TMS_CARRIER.billing_state)_ | | BillAddr.CountrySubDivisionCode |
| _(resolved TMS_CARRIER.billing_postal_code)_ | | BillAddr.PostalCode |

### Single carrier — full data flow

```
1. Salesforce webhook → Account (id=GYn1, TMS_Type=Carrier)
2. L2: replica_entity { entity_type='Account', source_id='GYn1', data={raw} }
3. L3: normalized_entity { canonical_type='TMS_CARRIER', data={name, billing_*} }

4. Salesforce webhook → TransportationProfile__c (id=AbCd)
5. L2: replica_entity { entity_type='TransportationProfile__c', data={raw} }
6. L3: normalized_entity {
     canonical_type='TMS_TRANSPORTATION_PROFILE',
     data={ mc_number:'MC-847291',
            carrier_account_id:'GYn1',
            remit_to_account_id:'GYn2' }
   }

7. Salesforce webhook → Account (id=GYn2, the Remit To account)
8. L2/L3: normalized as TMS_CARRIER { billing_street:'235 Saybrooke', billing_city:'Hartford' }

9. Stitch A fan-out fires for GYn1:
   - TMS_CARRIER (GYn1) → DisplayName='CN Joan Trucking', Phone='860-893-4389'
   - TMS_TRANSPORTATION_PROFILE → GivenName='MC-847291'
   - TMS_CARRIER (GYn2) → BillAddr.Line1='235 Saybrooke', City='Hartford'
   - Evaluates sync condition: TMS_Type=Carrier → group 1 passes → stitch fires

10. QB POST /vendor → Vendor created with all fields correctly set
11. global_entity_map: GYn1 (SF) ↔ QB_Vendor_123 stored
```

---

## 11. Custom Mapping — The Security & Scale Boundary

Nexiom scales multi-object mapping across thousands of connections using a dual strategy.

### 1. Standard Mapping via Configuration (The 90%)

For common integrators (e.g., Envoy Logistics, Bound Logistics), mapping is purely configuration-driven via the `MultiObjectMappingEditor` UI without any custom code. 

- **Account → Vendor** (Based on `TMS_Type`)
  - `MC Number` mapped from the secondary `TMS_TRANSPORTATION_PROFILE` tab.
  - `Billing Address` mapped from the secondary `Remit_To` canonical.
- **Account → Customer** (Based on `TMS_Type`)
- **VendorInvoice → Bill** (Load Number mapped to Memo, PO Number mapped to a custom field)
- **Invoice → CustomerInvoice**

### 2. Custom Logic Execution (The 10%)

For enterprise customers requiring bespoke logical transformations, we implement a **Phased Rollout Strategy** to balance initial iteration speed against long-term operational scale and security.

#### Phase 1: Monolithic Application Shards (Current Sandbox)

**Architecture:** Initially, to maintain high developer velocity while the product finds market fit, all tenant-specific custom logic is written directly within the platform monorepo.

**Code Organisation & Directories:**
Application Engineers build their custom components in partitioned directories strictly contained inside the application piece layer.

```text
packages/pieces/application/
  ├── revenova/
  │   ├── tenant_HQ92/
  │   │   └── index.ts        ← Exported `normalize()` specific to HQ92
  │   └── tenant_XYZ1/
  │       └── index.ts
  └── mcleod/
```

**Platform Execution:**
At the L4 Fan-out phase, the `LogicResolverService` uses standard Node dynamic routing (`packages/pieces/application/${appProfile}/tenant_${tenantId}`) to load the custom normalizer. Execution is purely native and zero-latency.

*Tradeoff:* The code executes in the same Node.js memory space as the platform. A severe tenant code bug (e.g., infinite loop) could impact the worker. 

#### Phase 2: Enterprise Sandboxing (Future Scale)

As the client volume scales (500+ tenants) and 3rd-party contractors enter the ecosystem, process security and dependency isolation become mathematically critical. We will port the Phase 1 directory structures entirely out of the monorepo via two enterprise execution models:

**Model A: Serverless RPC Extensions (The Stripe Pattern)**
Instead of executing natively, the tenant directories are extracted into a separate AWS Serverless repository. The core platform makes a secure HTTP POST call to an external Lambda/Cloudflare worker.
*Outcome:* Perfect memory, CPU, and dependency isolation. Scaling is offloaded to AWS.

**Model B: V8 Isolates / WebAssembly (The Figma Pattern)**
If network latency is unacceptable, the physical tenant directories are compiled into standalone, dependency-free JavaScript bundles (or Wasm binaries) and uploaded to an S3 bucket. The platform worker securely evaluates the fetched code using a constrained `isolated-vm` memory trap inside the native worker process.
*Outcome:* Mathematical security traps the untrusted code while maintaining microsecond native latency.

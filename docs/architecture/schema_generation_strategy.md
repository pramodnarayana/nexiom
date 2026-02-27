# Dynamic Schema Strategy: Replica & Canonical Layers

**Challenge:** As FluxNex scales to 500+ integrations, managing individual SQL tables for every possible object (e.g., `sf_account`, `qb_invoice`, `hs_company`) across thousands of tenant schemas creates a massive database migration bottleneck.

**Solution:** We move away from "Hardcoded SQL Columns" and adopt a "Generic JSONB + Application Type-Safety" strategy.

## 1. The Fallacy of "On-The-Fly DDL"

A common initial thought is: *"When a user connects Salesforce, we will dynamically execute `CREATE TABLE sf_account` in their schema."*

Why this fails:

- **API Drift:** If Salesforce adds a new field tomorrow, your SQL table is out of date.
- **Custom Fields:** Every Salesforce customer has custom fields (e.g., `__c_billing_id`). You would have to constantly run `ALTER TABLE` to add columns for every specific customer.
- **Connection Limits:** Running thousands of DDL (Data Definition Language) scripts concurrently locks Postgres tables and degrades performance.

## 2. Strategy 1: The Generic JSONB Strategy (Recommended)

PostgreSQL has world-class support for `JSONB`. Instead of creating tables per app, we create one generic table per layer and store the payload as an indexed JSON document.

### A. The Replica Layer Schema (Layer 2)

This table holds the exact data as it arrived from the source app.

```typescript
// packages/database-schema/src/tenant/replica_entity.ts
import { pgTable, uuid, varchar, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const replicaEntities = pgTable('replica_entity', {
  id: uuid('id').defaultRandom().primaryKey(),
  
  // Routing Identifiers
  sourceApp: varchar('source_app').notNull(),         // e.g., 'salesforce'
  entityType: varchar('entity_type').notNull(),       // e.g., 'account'
  sourceId: varchar('source_id').notNull(),           // e.g., '001Do00000abcde'
  
  // The Dynamic Schema!
  data: jsonb('data').notNull(),                      // Stores the full, raw JSON object
  
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // Standard Indexes
  appTypeIdx: index('app_type_idx').on(table.sourceApp, table.entityType),
  uniqueSource: uniqueIndex('unique_source_idx').on(table.sourceApp, table.entityType, table.sourceId),
  
  // THE MAGIC: GIN Index for deep JSON searching by Support Teams
  dataGinIdx: index('replica_data_gin_idx').using('gin', table.data)
}));
```

### B. The Canonical Layer Schema (Layer 3)

This table holds your standardized business objects.

```typescript
// packages/database-schema/src/tenant/normalized_entity.ts
import { pgTable, uuid, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

export const normalizedEntities = pgTable('normalized_entity', {
  id: uuid('id').defaultRandom().primaryKey(),
  
  canonicalType: varchar('canonical_type').notNull(), // e.g., 'TMS_VENDOR'
  
  // The Dynamic Schema!
  data: jsonb('data').notNull(),                      // e.g., { vendorName: 'Acme', city: 'Chicago' }
  
  status: varchar('status').default('VALID'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  typeIdx: index('type_idx').on(table.canonicalType),
  
  // THE MAGIC: GIN Index for deep JSON searching
  dataGinIdx: index('norm_data_gin_idx').using('gin', table.data)
}));
```

## 3. Enforcing Schema Integrity (The Zod Guard)

**If the database accepts any JSON, how do we prevent garbage data?**
We enforce the schema at the Application Layer, not the Database Layer.

### A. The Canonical Gatekeeper (Strict)

Because you own the Canonical models, you define them strictly in code.

```typescript
import { z } from 'zod';

export const TMSVendorSchema = z.object({
  vendorName: z.string().min(1),
  contactEmail: z.string().email().optional(),
  billingCity: z.string().optional(),
}).strict(); 
```

### B. The Replica Gatekeeper (Permissive)

Because external apps own the Replica models, and customers have custom fields, we make the Zod schema passthrough.

```typescript
import { z } from 'zod';

export const SalesforceAccountSchema = z.object({
  Id: z.string(), // Must have an ID for routing
  Name: z.string(), // Must have a Name for routing
}).catchall(z.any()); // Catch-all allows customer-specific fields (e.g., "__c_custom") to pass through
```

## 4. How to Auto-Generate the Schemas (The 500+ Strategy)

To support 500+ apps, do not manually type Zod schemas.

- Download the vendor's `openapi.json` file.
- Use an open-source CLI tool (like `openapi-zod-client`) to auto-generate the TypeScript Zod validation files.
- If an OpenAPI spec is missing, programmatically translate the Activepieces Property framework inputs into Zod schemas.

## 5. Summary Flow

- **Ingestion:** Raw JSON arrives via Webhook (Push) or Cron (Pull).
- **Replica:** Worker validates JSON using an auto-generated permissive Zod schema. Saves to `replica_entity` (JSONB).
- **Normalization:** Worker maps data. Validates using a strict Canonical Zod schema. Saves to `normalized_entity` (JSONB).

## 6. Rendering JSONB in the UI (Dynamic Tables)

Since all data is stored in a generic `data` JSONB column, we use TanStack Table with dynamic accessor keys to flatten the JSON into a readable table for the Support Team.

```typescript
// apps/web/src/config/table-views.ts
export const VENDOR_VIEW_CONFIG = [
  { header: 'ID', accessorKey: 'id' },                      // Root column
  { header: 'Status', accessorKey: 'status' },              // Root column
  { header: 'Vendor Name', accessorKey: 'data.vendorName' },// Nested JSON column
  { header: 'City', accessorKey: 'data.address.city' },     // Deeply Nested JSON column!
];
```

Because the columns are defined in config, the backend stays fast and dumb, while the React client flattens the JSON for the table.

## 7. Field Mapping UI & The "Stitch" Concept

In the UI, a **Stitch** represents the data pipeline (e.g., Revenova Vendor -> QuickBooks Vendor).
The Mapping UI belongs directly inside this Stitch view as the first tab.

- **Mental Model:** It tightly couples the **Rules** of the data flow (the mapping) with the **Logs** of the data flow (Inbound, Replica, Normalized, Outbound tabs).
- **Contextual Debugging:** If a record fails in the "Normalized" tab due to a missing field, the user can immediately click the "Field Mapping" tab right next to it to fix the rule.

## 8. Deep JSON Mapping (JSON Path Notation)

When mapping data, customers map individual fields from deep inside the dynamic Canonical JSON blob to the destination app.

### 1. The Source: The JSON Blob

A `TMS_VENDOR` object is stored in your database's `JSONB` column like this:

```json
{
  "vendorId": "v-123",
  "vendorName": "Acme Logistics",
  "contact": { "primaryEmail": "billing@acme.com" }
}
```

### 2. The UI Experience (Dot Notation)

The React Frontend flattens this JSON into a list of selectable items using dot notation. The user selects deeply nested paths from a dropdown (e.g., `contact.primaryEmail`).

### 3. What the UI Saves (The Mapping Template)

The frontend wraps the selected path in template tags (`{{ }}`) and saves it to the `field_mappings` database table.

```json
{
  "DisplayName": "{{vendorName}}",
  "PrimaryEmailAddr": {
    "Address": "{{contact.primaryEmail}}"
  }
}
```

### 4. How the Engine Executes It (Layer 4 Hydrator)

The Outbound Prep Worker (Layer 4) uses a Hydrator (powered by `lodash.get` or Mustache.js) to parse the template at runtime.

```typescript
import { get } from 'lodash';

function hydrateTemplate(templateStr: string, realJsonBlob: any) {
    // Looks for {{contact.primaryEmail}}, walks down the realJsonBlob, and replaces it with "billing@acme.com"
    return templateStr.replace(/\{\{(.*?)\}\}/g, (match, path) => {
        return get(realJsonBlob, path.trim(), ""); 
    });
}
```

## 9. Summary of Capabilities Achieved

By utilizing this Generic JSONB strategy combined with the Dynamic Mapping engine, the platform achieves exactly what is needed for a modern iPaaS:

- **Infinite Scale (500+ Apps):** You can add new integrations instantly. You never have to write or run a `CREATE TABLE` database migration when adding a new app.
- **Custom Field Support:** If a customer adds a custom field (`Discount_Level__c`) to their Salesforce account today, your system ingests and saves it automatically into the JSON blob without crashing or requiring schema updates.
- **High-Performance Support Search:** By adding a GIN Index to the `JSONB` column, your support team can search for specific nested values (e.g., `INV-12345`) across millions of records in milliseconds.
- **Dynamic Data Grids:** Your React frontend (using TanStack Table) can render beautiful, flat tables by simply reading dot-notation paths (like `data.contact.email`) directly from the JSON payload.
- **Granular Field Mapping:** Your UI can expose the entire JSON tree to the customer, allowing them to map deep, specific values (e.g., `{{address.city}}`) to their destination apps using your Layer 4 Hydrator.

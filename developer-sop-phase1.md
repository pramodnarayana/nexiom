# Application Developer SOP (Phase 1 Detailed Workflow)

This guide provides the granular, step-by-step instructions for an application developer working strictly inside the `soopapieces` repository.

**Scenario:** We are adding a new sync from *Revenova Vendor Invoice ➡️ QuickBooks Bill*. This requires adding a new `tms_vendor_invoice` table to the canonical domain.

---

## 1. Coding (Schema & Logic)

### Step 1.1: Define the TypeScript Schema (No SQL)

The database structure is managed exclusively via TypeScript. You **never** write raw SQL statements.

1. Open `plugins/domain/tms/src/schema/tms-schema.ts`.
2. Add the new Drizzle table definition:

```typescript
export const tmsVendorInvoice = pgTable('tms_vendor_invoice', {
    id: serial('id').primaryKey(),
    sourceId: text('source_id').notNull().unique(),
    totalAmount: doublePrecision('total_amount'),
    createdAt: timestamp('created_at').defaultNow()
});
```

### Step 1.2: Generate the Migrations

Generate the runtime SQL assets that the platform will use for JIT provisioning.

1. In your terminal, run `pnpm build` (or `pnpm drizzle-kit generate` if configured locally).
2. Verify that a new `.sql` file appears in your `drizzle/migrations` folder.

### Step 1.3: Update the Normalized Writer

Tell the domain layer how to save this new canonical type.

1. Open `plugins/domain/tms/src/tms-normalized-writer.ts`.
2. Add a `case 'TMS_VENDOR_INVOICE':` to the switch statement containing the `.insert().onConflictDoUpdate()` logic.

### Step 1.4: Write the Mapping (The Trigger is Generic!)

Because the webhook trigger code is generic and already written, you do not need to rewrite parsing logic again and again. You only need to translate the data.

1. **The Mapping:** Create `normalizeRevenovaVendorInvoice.jsonata` to transform the raw Salesforce/Revenova payload into your canonical `TMS_VENDOR_INVOICE` domain shape.

---

## 2. Manual Testing (The Feedback Loop)

Before writing automated tests, you often need a quick feedback loop to ensure your JSONata mapping works.

1. **Create a Fixture:** Save a real Revenova webhook payload into a local JSON file (e.g., `scratch/revenova-webhook-fixture.json`).
2. **Write a Scratch Script:** Create a quick Node script (`scratch/test-mapping.ts`) that runs your JSONata engine against the fixture.
3. **Execute:** Run `npx tsx scratch/test-mapping.ts` to instantly `console.log` the output of your mapping in the terminal. Adjust your `.jsonata` file until the output perfectly matches the `TMS_VENDOR_INVOICE` schema.

---

## 3. Automated Testing (Unit/Integration)

Once you are happy with the manual output, formalize it into a Vitest test suite. These tests do not require a database.

1. **Test the Mapping:**
   In `normalizeRevenovaVendorInvoice.spec.ts`, write unit tests that feed your fixture into the JSONata mapping and assert the output structure.

   ```typescript
   it('should correctly map TotalAmount from Revenova to TMS_VENDOR_INVOICE', () => {
       const result = evaluateMapping(fixture);
       expect(result.canonicalType).toBe('TMS_VENDOR_INVOICE');
       expect(result.data.totalAmount).toBe(1500.00);
   });
   ```

2. **Run Unit Tests:** `pnpm test`

---

## 4. E2E Automated Testing (The "Mock Platform")

Prove your piece can successfully write to the database (L1 ➡️ L3) without booting the Nexiom platform.

### Step 4.1: The Test Setup (Testcontainers)

Configure **Testcontainers** to spin up a temporary Postgres database specifically for this test run.

```typescript
import { PostgreSqlContainer } from '@testcontainers/postgresql';

let container;
let db;

beforeAll(async () => {
    // Spin up an isolated DB
    container = await new PostgreSqlContainer().start();
    db = setupDrizzle(container.getConnectionUri());

    // Run the Drizzle Migrator to create the tms_vendor_invoice table
    await migrate(db, { migrationsFolder: './drizzle/migrations' });
});

afterAll(async () => {
    await container.stop(); // Destroy the DB
});
```

### Step 4.2: The Execution & Assertion

Run the full pipeline against the temporary database.

```typescript
it('should successfully ingest a webhook and write to the database', async () => {
    // 1. Simulate L1 (Webhook Ingress via Generic Trigger)
    const rawPayload = parseWebhook(fixture);

    // 2. Simulate L2 (Mapping)
    const canonicalRecord = mappingEngine.execute('normalizeRevenova.jsonata', rawPayload);

    // 3. Simulate L3 (Database Write)
    await tmsNormalizedWriter(canonicalRecord, db);

    // 4. The Assertion (Query the temporary DB)
    const savedRows = await db.select().from(tmsVendorInvoice);
    expect(savedRows.length).toBe(1);
});
```

*Run `pnpm test:e2e` to verify.*

---

## 5. Local Platform UI Testing (Hot Reloading)

Before opening a Pull Request, you must verify your integration works visually inside your local `nexiom` platform. Because Nexiom is a dynamic architecture, you do **not** use `yalc` or restart the server.

1. **Build the Local Bundle (`soopapieces`):**
   In your `soopapieces` terminal, run:

   ```bash
   pnpm build
   ```

   This generates the JavaScript bundles and `.sql` migration files.

2. **Trigger the Local Hot-Reload:**
   Copy the generated `.tgz` package (or point the local platform's plugin directory to your `dist` folder).
   The local `nexiom` platform's Background Poller will instantly detect the new local bundle.

3. **Verify the Background Automation:**
   Watch your local `nexiom` terminal. You will see the platform automatically:
   - Hot-load the new JavaScript into memory.
   - Run the background Drizzle Migrator to automatically create the `tms_vendor_invoice` table in your local Postgres database.

4. **Execute the End-to-End Flow in the UI:**
   Open your browser to your local Nexiom instance and perform the following sequence to prove the integration works exactly as a user would experience it:
   - **Step A:** Fire a test webhook from Revenova and verify that the data successfully flows into Nexiom and is saved correctly in your newly provisioned `tms_vendor_invoice` normalization table.
   - **Step B:** Once the data is populated, use the UI to create the "Revenova Vendor Invoice ➡️ QB Bill" Stitch and configure the field mapping.
   - **Step C:** Execute the stitch and verify that the platform correctly pushes the data out of the normalized table and creates the Bill in QuickBooks!

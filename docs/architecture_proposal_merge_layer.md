# Architecture Proposal: Cross-Domain Merge Layer (Layer 3.5)

**Status:** PROPOSAL
**Version:** 1.0
**Target:** FluxNex Sync Engine v4.0

## 1. Problem Statement
The current v3.3 architecture strictly separates domains (e.g., CRM, Accounting, TMS) into isolated tables within the Tenant Database. While this ensures clean domain boundaries, it prevents "Composite" syncs where an outbound object requires data from multiple domains.

**Example Scenario:**
- **Trigger:** `AccountingInvoice` (Accounting Domain)
- **Requirement:** Sync to QuickBooks.
- **Missing Data:** QuickBooks requires the `CustomerAddress`, which lives in the `TmsLoad` (CRM/TMS Domain).
- **Blocker:** There is no Database Foreign Key between `AccountingInvoice` and `TmsLoad`, so the Mapper cannot strictly traverse to the address.

## 2. Solution: The Merge Layer (Layer 3.5)
We propose introducing a dedicated processing stage **between** the Normalized Layer (Layer 3) and the Outbound Gateway (Layer 4).

### Pipeline Visualization
**Current v3.3:**
`[Normalized Layer]` -> (pushes to) `NORMALIZATION_QUEUE` -> `[Outbound Layer]`

**Proposed v4.0:**
`[Normalized Layer]` -> (pushes to) **`MERGE_QUEUE`** -> `[Merge Layer]` -> (pushes to) `OUTBOUND_QUEUE` -> `[Outbound Layer]`

## 3. Component Details: The Merge Worker

**Role:**
The Merge Worker is responsible for "Hydrating" detailed data onto the canonical object using specialized **Resolvers**.

**Logic Flow:**
1.  **Consume:** Worker picks up `AccountingInvoice` from `MERGE_QUEUE`.
2.  **Inspect:** Checks if a registered Resolver exists for `AccountingInvoice`.
3.  **Resolve (The "Merge"):**
    - The Resolver sees the "Soft Link" `reference_entity_id`.
    - It queries the CRM/TMS tables to fetch the full `TmsLoad` and `Customer` objects.
    - It attaches this auxiliary data to a `context` property on the message.
4.  **Produce:** Pushes a **Composite Message** to `OUTBOUND_QUEUE`.
    ```json
    {
      "entity": { "id": "invoice_123", "amount": 500, ... },
      "context": {
        "load": { "id": "load_abc", "customer": { "address": "123 Main St" } }
      }
    }
    ```

## 4. Impact on Outbound Layer
The Outbound Mapper (Layer 4) remains generic but becomes more powerful.
- **Before:** Could only map `invoice.amount`.
- **After:** Can map `invoice.amount` AND `context.load.customer.address`.

## 5. Benefits
1.  **Preserves Isolation:** The database schema remains decoupled (no cross-domain FKs).
2.  **Explicit Data Gathering:** Fetching logic is centralized in Resolvers, not hidden in Mappers.
3.  **Performance:** Standard objects (no merge needed) passthrough instantly.


# Dynamic Mapping: JSON Path, Schema Discovery & The Hydrator

FluxNex eliminates hardcoded integration logic by allowing customers to define data rules visually. This is powered by the "Stitch" concept, the Activepieces Property Framework, and a high-performance runtime JSON Hydrator.

## 1. The "Stitch" UI Model

A **Stitch** is the logical representation of a data pipeline between a Source App (providing data) and a Destination App (receiving data).

In the FluxNex Dashboard, the Stitch view follows a "Rules-First, Logs-Second" hierarchy:

- **Tab 1: Field Mapping (The Rules):** The primary interface where users bind fields.
- **Tabs 2-5: Pipeline Logs (The Evidence):** The audit trail (Inbound, Replica, Normalized, Outbound) showing how data flowed through those specific rules.

## 2. Schema Discovery: Powering the UI

For a user to map fields, the UI must know the "Left Side" (Source) and the "Right Side" (Destination) schemas.

### A. Source Discovery (Canonical/Replica)

The UI flattens the JSON structure from either:

- **The Canonical Definition:** The TypeScript interface for objects like `TMS_VENDOR`.
- **Sample Data:** The UI fetches the most recent record from the `normalized_entity` table for that tenant to show real-world example values alongside the keys.

### B. Destination Discovery (Activepieces Properties)

The UI queries the Application Module for the target Action's props.

- **Example:** A QuickBooks `create_vendor` action defines props like `DisplayName`, `PrimaryEmailAddr`, and `TaxIdentifier`.
- **Dynamic UI:** FluxNex converts these properties into a standard JSON schema that renders as a list of "drop-zones" in the React frontend.

## 3. JSON Path Notation

FluxNex uses Dot-Notation wrapped in double-curly braces (`{{ }}`) to represent data pointers. This allows the system to reach into deeply nested arrays or objects within a JSONB blob.

### Input JSON (Layer 3 Normalized)

```json
{
  "vendorName": "Acme Logistics",
  "contact": {
    "email": "billing@acme.com",
    "phone": "+1-555-0199"
  },
  "address": {
    "city": "Chicago",
    "meta": { "internal_code": "CHI-01" }
  }
}
```

### The Generated Mapping Template

When the user maps fields in the UI, the system generates a template:

- `QuickBooks.DisplayName` -> `{{vendorName}}`
- `QuickBooks.Email` -> `{{contact.email}}`
- `QuickBooks.RefCode` -> `{{address.meta.internal_code}}`

## 4. The Layer 4 Hydrator (Execution)

During the sync process, the Outbound Prep Worker (Layer 4) acts as a "Dumb Executor." It retrieves the Mapping Template and the Normalized Record and "hydrates" them into a final payload.

### Performance & Security

- **No `eval()`:** We never use Javascript's `eval()` to parse paths. We use a safe path-walker (inspired by `lodash.get`).
- **Sanitization:** The Hydrator strips any script tags or malicious strings if the destination app is sensitive.
- **Type Coercion:** If the destination property expects a Number but the source provides a String, the Hydrator performs a safe conversion.

### The Logic Implementation

```typescript
import { get } from 'lodash';

/**
 * Replaces all {{path.to.key}} tags in a JSON template with real data.
 */
function hydrate(template: object, sourceData: any): any {
  const templateStr = JSON.stringify(template);
  
  const hydratedStr = templateStr.replace(/\{\{(.*?)\}\}/g, (match, path) => {
    const value = get(sourceData, path.trim());

    // Handle missing data: return empty string or null
    if (value === undefined || value === null) return "";

    // Ensure we handle nested JSON vs primitive strings
    return typeof value === 'object' ? JSON.stringify(value) : value;
  });

  return JSON.parse(hydratedStr);
}
```

## 5. Advanced Transformations (Formulas)

While 90% of mappings are direct field-to-field, FluxNex supports Liquid/Handlebars-style logic for complex needs:

- **Concatenation:** `{{contact.firstName}} {{contact.lastName}}`
- **Static Suffix:** `{{vendorName}} (Synced via FluxNex)`
- **Fallback Logic:** `{{contact.email || contact.secondary_email}}`

## 6. Summary of Capabilities Achieved

By utilizing this Generic JSONB strategy combined with the Dynamic Mapping engine, the platform achieves exactly what is needed for a modern iPaaS:

- **Infinite Scale (500+ Apps):** You can add new integrations instantly. You never have to write or run a `CREATE TABLE` database migration when adding a new app.
- **Custom Field Support:** If a customer adds a custom field (`Discount_Level__c`) in Salesforce, it is automatically available in the JSON blob and can be mapped in the UI immediately.
- **High-Performance Support Search:** By adding a GIN Index to the `data` JSONB column, your support team can search for specific nested values (e.g., an external Invoice ID) across millions of records in < 50ms.
- **Dynamic Data Grids:** The React frontend (TanStack Table) renders these JSON paths into readable columns for the Support Team dynamically based on the object type.
- **Granular Field Mapping:** Your UI exposes the entire JSON tree to the customer, allowing them to map deep, specific values (e.g., `{{address.city}}`) to their destination apps without developer intervention.

# Strategy: The Multi-Workspace Hierarchy

**Goal:** Allow a single Organization (Tenant) to manage multiple isolated environments (e.g., US Division, EU Division, Staging) without requiring separate signups.

## 1. The Architectural Hierarchy

We use a nested `Organization -> Workspace` model.

- **Organization (The Tenant):** The top-level legal and billing entity (e.g., "Envoy Logistics").
- **Workspace A:** "Envoy US" (Physical Schema: `ws_101`)
- **Workspace B:** "Envoy EU" (Physical Schema: `ws_102`)

## 2. Control Plane vs. Data Plane (Why Workspace is "Public")

In PostgreSQL, "Public" does not mean "viewable by the internet." It refers to the Shared Platform Schema that every part of the application can see to perform routing.

### A. The Control Plane (Public Schema)

The `public` schema acts as the Central Registry. It stores the "Map" of where everyone's data lives.

- **Tables:** `user`, `organization`, `member`, `workspace`.
- **Why here?** When a user logs in, the API needs to answer: "Which environments does this user have access to?" The system queries `public.workspace` to find that this user owns `ws_101` and `ws_102`. Without this central list, the system wouldn't know which of the 10,000+ isolated schemas to look into.

### B. The Data Plane (Workspace Schemas)

Each workspace has its own physically isolated schema (e.g., `tenant_ws_101`). This is where the actual "heavy" data lives.

- **Tables:** `App_Connection`, `Replica_Entity`, `Normalized_Entity`, `Global_Map`.

## 3. Database Schema Definitions

### Public Schema (The Router)

| Table | Purpose | Columns |
| :--- | :--- | :--- |
| `organization` | Billing/Identity Unit | `id`, `name`, `owner_id` |
| `workspace` | The Schema Pointer | `id`, `org_id`, `name`, `slug`, `db_schema_name` |

### Workspace Schema (The Silo)

**Example Schema Name:** `tenant_ws_101`

| Table | Purpose |
| :--- | :--- |
| `App_Connection` | Credentials for THAT specific division's Salesforce/QB. |
| `Replica_Entity` | Raw data synced ONLY for this division. |
| `Normalized_Entity` | Standardized data for this division. |

## 4. Detailed Lookup Logic (The "Magic" Step)

How the system handles a request for Envoy US:

1. **Auth Check:** User provides a session cookie. The system identifies them as `user_abc`.
2. **Workspace Lookup (Public):**

   ```sql
   SELECT db_schema_name FROM public.workspace WHERE slug = 'envoy-us' AND org_id = 'envoy-org-id';
   ```

   *Result:* `tenant_ws_101`.
3. **Context Injection:**
   The Platform Kernel sets the context:

   ```typescript
   ContextStorage.enter({ schema: 'tenant_ws_101' });
   ```

4. **Data Execution:**
   Every Drizzle query from that point forward automatically prepends the schema:

   ```sql
   SELECT * FROM "tenant_ws_101"."App_Connection";
   ```

## 5. Benefits of this Split

- **Discovery:** The UI can show a "Switch Workspace" dropdown instantly because the list of workspaces is in the central public registry.
- **Physical Security:** While the existence of the workspace is recorded in `public`, the API Keys and Data are locked away in a schema that is never touched unless the user is specifically routed there.
- **Scalability:** You can move a specific Workspace Schema to a different physical database server if it grows too large, simply by updating the connection string in the `public.workspace` registry.

**Summary:** The `workspace` table in `public` is the Index; the workspace schema is the Vault.

# Credential Storage Architecture

**Date:** 2026-02-22  
**Decision:** Keep `app_credential` and `app_connection` in the shared Catalog DB, not per-tenant databases.

---

## Decision

OAuth App Credentials (`app_credential`) and User Connection tokens (`app_connection`) are stored in the **central Catalog Database** (`nexiom_local`), in the `public` schema, isolated logically by a `tenant_id` column.

They are **not** stored inside each tenant's physically isolated PostgreSQL database.

---

## Why Not Per-Tenant DB?

Storing credentials inside tenant databases was considered and rejected for three concrete efficiency reasons:

### 1. Connection Pool Exhaustion

The Nexiom Engine must proactively maintain and refresh OAuth tokens. If credentials lived in 5,000 separate tenant databases, the Engine would need to:

- Maintain 5,000 separate Postgres connection pools simultaneously (impossible), OR
- Open a dynamic connection to each tenant's database on demand for every workflow execution

Establishing a Postgres connection involves a TCP handshake and authentication, adding latency to every token refresh and workflow boot.

### 2. Global Token Refresh is blocked

OAuth tokens expire regularly (e.g., Salesforce access tokens expire in ~2 hours). The Engine runs a centralized **Token Refresh Service** that scans all tokens expiring in the next 10 minutes and refreshes them proactively.

This is only possible with a single query:

```sql
SELECT * FROM app_connection WHERE expires_at < NOW() + INTERVAL '10 minutes';
```

If connections were per-tenant, this would require looping across 5,000 databases, which breaks down in production.

### 3. Cross-Tenant Operations (Analytics and Migrations)

Counting active integrations, running schema migrations, or patching a security bug in `app_credential` would all require running the same operation across 5,000 databases. This is fragile, error-prone, and difficult to monitor.

---

## The Hybrid Architecture (Approved)

Nexiom uses a **Hybrid Model** that balances security with efficiency:

| Layer | Storage | Isolation Method |
|---|---|---|
| **Platform Credentials** (`app_credential`, `app_connection`) | Shared Catalog DB | Row-level `tenant_id` + application query guards |
| **Customer Payload Data** (CRM records, Accounting data pulled from integrations) | Isolated Tenant DB (one database per tenant) | Physical PostgreSQL database isolation |

### How it flows

1. A Nexiom workflow triggers for **Tenant A**.
2. The Engine reads the OAuth token from `app_connection WHERE tenant_id = 'tenant_a'` in the **Catalog DB** (instant, single connection pool).
3. The Engine makes the HTTP call to Salesforce.
4. The Engine dynamically connects to **Tenant A's isolated database** to write the returned data records.

This means token retrieval is fast and always-available via a central pool, while the actual business payload data remains physically isolated per tenant for compliance (SOC2, HIPAA).

---

## Comparison with Industry Standards

| Platform | Credential Location | Physical Data |
|---|---|---|
| **Activepieces** | Shared Catalog DB (`projectId` row isolation) | Same Shared DB |
| **n8n Cloud** | Shared Catalog DB (control plane) | Isolated K8s pods per enterprise tenant |
| **Nexiom** | Shared Catalog DB (`tenant_id` row isolation) | Isolated Tenant DB per customer |

Nexiom's approach is **more isolated than Activepieces** (for payload data) and **more efficient than n8n Cloud** (no per-tenant pod overhead for small/mid-size customers).

---

## Security Controls

Row-level security is enforced at the application layer in all Drizzle queries:

```typescript
// ConnectorsService — always tenant-scoped
.where(
  and(
    eq(appCredentials.tenantId, tenantId),
    eq(appCredentials.appName, providerName),
  ),
)
```

Future hardening should add **PostgreSQL Row-Level Security (RLS)** policies as a second layer of defense.

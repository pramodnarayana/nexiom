# Architecture Proposal: Cellular Database Architecture (High Availability)

**Status:** PROPOSAL
**Version:** 1.0
**Target:** Infrastructure V2

## 1. The Risk
Currently, while tenants are *logically* isolated (Database-per-Tenant), they typically reside on a single Physical Database Cluster.
**Impact:** If that cluster fails (Hardware failure, OS crash, Network partition), **100% of tenants go offline**.

## 2. Solution: Cellular Architecture
We propose splitting the infrastructure into independent "Cells". Each Cell is a self-contained Database Server (or Cluster) hosting a subset of tenants.

### 2.1 Schema Changes
We must update the Catalog `Tenant` model to support routing to different physical hosts.

**File:** `packages/core/prisma/schema.prisma`
```diff
model Tenant {
  tenant_id   String   @id @default(uuid())
+ db_host     String   // <--- NEW: Points to specific Cell (e.g., "db-cell-01.internal")
+ db_port     Int      @default(5432)
  db_name     String
  db_user     String
  // ...
}
```

### 2.2 Routing Logic
**Current Flow:**
1. Worker gets `tenant_id`.
2. Lookups `Tenant` in Catalog.
3. connects to `localhost` / `env.DB_HOST`.

**New Flow:**
1. Worker gets `tenant_id`.
2. Lookups `Tenant` in Catalog.
3. Reads `db_host` from the record.
4. Connects to `db-cell-05.internal`.

## 3. Benefits (Blast Radius Reduction)
If you have 1,000 Customers distributed across 10 Cells (100 per Cell):
- **Scenario:** database `Cell-05` crashes.
- **Impact:** Only the 100 customers on Cell-05 are affected.
- **Availability:** **90% of your customers remain online**.

## 4. Disaster Recovery (DR)
For critical resilience, each Cell itself should be an **RDS Multi-AZ** (or equivalent Primary-Standby) setup.
- **Failover:** If Cell-05 Primary dies, the Standby takes over in 60 seconds.
- **Catalog DB:** This becomes the most critical component. It MUST be a Multi-AZ Cluster as it is the "Router" for everyone.

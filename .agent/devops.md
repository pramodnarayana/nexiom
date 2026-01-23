# Role: DevOps Engineer (Nexiom)

## Mission

Maintain the **"Inner Loop"** (Local Developer Experience) and **"Outer Loop"** (Production CI/CD). Your goal is to make the Monorepo feel like a single cohesive tool.

## 1. Local Development (DX)

You own the `docker-compose.yml` file. It must replicate AWS services locally so developers don't need cloud access.

* **PostgreSQL:** Standard container.

* **LocalStack:** Simulates SQS and KMS.

* **Redis:** Simulates ElastiCache.

* **WireMock:** Simulates external APIs (QuickBooks/Salesforce) for integration testing.

## 2. CI/CD Pipeline (GitHub Actions)

You are responsible for the **Build -> Promote** workflow.

* **CI (Pull Request):**

  * Run `eslint` and `prettier`.

  * Run `vitest` (Frontend) and `jest` (Backend).

  * **Build Check:** Ensure Docker images build successfully.

* **CD (Merge to Main):**

  1. **Build:** Create Docker images for `web`, `api`, `core-worker`.

  2. **Tag:** Use Commit SHA (`sha-xyz`).

  3. **Push:** Upload to AWS ECR.

  4. **Deploy Dev:** Update ECS Service `nexiom-dev`.

* **Release (Tag/Manual):**

  * **Promote:** Retag existing image `sha-xyz` to `:prod`.

  * **Deploy Prod:** Update ECS Service `nexiom-prod`.

## 3. Database Management

* **Migration Strategy:** You must handle the **Two-Phase Migration**:

  1. **Core Migrations:** Run on deploy (updates `public` schema).

  2. **Tenant Migrations:** Ensure the `tenant-provisioning` scripts (stored in `packages/core`) are up to date with the Drizzle schema.

## 4. Observability

* **OpenTelemetry:** Ensure all 6 Layers propagate `trace_id`.

* **Logs:** Configure CloudWatch Agent to capture structured JSON logs from Fargate.

* **Alarms:** Set up alerts for "DLQ Depth > 10" (Stuck messages).

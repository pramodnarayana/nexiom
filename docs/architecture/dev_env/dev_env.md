# Architecture: AWS Emulation & Local Environment Parity

To ensure high developer velocity and "Zero Cloud Friction," FluxNex emulates its production AWS footprint entirely within a local Docker-based environment. This allows engineers to build, test, and debug the pipeline on a laptop while remaining 100% binary-compatible with the Production cloud.

---

## 1. The Emulation Matrix

We map every production-grade AWS service to an open-source local equivalent.

| AWS Production Service | Local Emulation Tool | Port | Implementation Detail |
| --- | --- | --- | --- |
| Amazon Aurora (PG) | PostgreSQL (Alpine) | `5432` | Standard container with all `ws_{id}` schemas. |
| AWS SQS | LocalStack | `4566` | Emulates the SQS API for the SEDA pipeline queues. |
| AWS KMS | LocalStack / Crypto | `4566` | Provides local encryption keys for credential storage. |
| AWS ElastiCache | Redis (Alpine) | `6379` | Handles refresh locks and BullMQ job tracking. |
| AWS Fargate (API) | Docker Compose | `4000` | Runs the API Gateway — webhook ingestion at `localhost:4000/webhooks`. |
| AWS Fargate (Workers) | Docker Compose | N/A | Runs the Engine Workers (L2–L6 pipeline). |
| CloudFront / S3 SPA | Vite Dev Server | `3000` | Local Dashboard — sync traces visible at `localhost:3000`. |
| External APIs | Prism (Stoplight) | `4010` | Mocks Salesforce and QuickBooks OpenAPI specs. |

---

## 2. The Software Bridge: The Adapter Pattern

The Platform Kernel (`packages/core-kernel`) never calls the AWS SDK directly without an abstraction. We use the Adapter Pattern to toggle between cloud and local logic.

### A. Dependency Injection (NestJS)

The kernel uses an `INFRA_MODE` environment variable to decide which class to instantiate at runtime.

**Accepted `INFRA_MODE` values:**

| Value | Behavior | Dependencies |
| --- | --- | --- |
| `local` | Uses local emulation — `LocalCryptoAdapter` (Node.js `crypto`) and SQS pointed at LocalStack (`localhost:4566`). No AWS credentials required. | Node.js built-in `crypto` module |
| `production` | Uses live AWS services — `AwsKmsAdapter` and SQS pointed at AWS. Requires `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`. | `@aws-sdk/client-kms`, `@aws-sdk/client-sqs` |

**Default:** `local` (set in `.env.local` or `docker-compose.yml` environment block).

**Where to set it:** Add `INFRA_MODE=local` to your `.env` file or to the `environment:` section of the relevant service in `docker-compose.yml`. The API and all worker containers must share the same value.

```typescript
// Example: Encryption Service Factory
const EncryptionServiceProvider = {
  provide: 'ENCRYPTION_SERVICE',
  useFactory: () => {
    // INFRA_MODE=local  → LocalCryptoAdapter (Node.js 'crypto', no AWS credentials needed)
    // INFRA_MODE=production → AwsKmsAdapter ('@aws-sdk/client-kms', requires IAM role/keys)
    return process.env.INFRA_MODE === 'local'
      ? new LocalCryptoAdapter() // Uses Node.js 'crypto' module
      : new AwsKmsAdapter();     // Uses '@aws-sdk/client-kms'
  },
};
```

### B. Endpoint Redirection

For services like SQS, we use the real AWS SDK but point the endpoint to our LocalStack container.

```typescript
const sqsClient = new SQSClient({
  region: 'us-east-1',
  endpoint: process.env.INFRA_MODE === 'local' ? 'http://localhost:4566' : undefined,
});
```

---

## 3. Mocking the "Outside World" (Prism)

A major hurdle in iPaaS development is testing Layer 5 (Delivery) without hitting real API rate limits or using expensive developer accounts.

- **OpenAPI Specs:** We store the `openapi.json` for every piece (e.g., Salesforce) in the repo.
- **Prism Mocking:** Docker spins up a Prism container that reads these JSON files.
- **Local Routing:** In local mode, the `TokenManagerService` returns a fake token, and API calls are routed to `http://localhost:4010`.
- **Validation:** Prism returns a `400 Bad Request` if your mapping produces an invalid payload according to the vendor's spec, allowing you to debug mapping errors locally.

---

## 4. End-to-End Local Execution Flow

1. **Ingestion:** Developer sends a `curl` to `localhost:4000/webhooks`.
2. **L1 Gateway:** The worker sets the `search_path` to the local Postgres container and saves the raw JSON.
3. **Queueing:** A message is sent to LocalStack SQS.
4. **SEDA Loop:** Local workers consume from LocalStack, process data through the layers, and perform ID cross-referencing in the local GEM table.
5. **Audit:** The developer opens the Local Dashboard (`localhost:3000`) and sees the successful sync trace.

---

## 5. Summary of Benefits

| Benefit | Detail |
| --- | --- |
| **Cost** | $0.00 AWS bill for the entire engineering team during the build phase. |
| **Speed** | Webhook-to-Replica latency is sub-10ms on local SSDs. |
| **Privacy** | No customer data (even test data) ever leaves the developer's machine. |
| **Parity** | If the code works on LocalStack, it will work on AWS — the SDK calls are identical. |

---

## 6. Setup Command

To initialize the full simulated cloud, run:

```bash
docker-compose up -d
pnpm run db:fresh
pnpm run dev
```

> `db:fresh` drops the existing database, re-runs all Drizzle migrations, and seeds development fixtures (connections, workspace, test credentials). Use `pnpm run db:migrate` instead if you only need to apply new migrations without resetting data.

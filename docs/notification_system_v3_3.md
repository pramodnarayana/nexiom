# Notification System Module (v3.3)

## 1. Architecture Overview
We utilize a **Queue-Based Decoupling** strategy (Service-Based Outbox). This ensures that the act of *recording* an error is fast and synchronous, while the act of *delivering* it is asynchronous.

**High-Level Flow**:
`Sync Worker` -> `DB Insert` -> `SQS/Queue Push` -> `Notification Worker` -> `Novu API`

## 2. The Workflow

### Phase A: Error Capture (Sync Engine)
When any worker encounters a Business Error (e.g. Validation Failed):
1.  **Persist**: Inserts record into `Notification_Log` table.
    *   Status: `PENDING`
2.  **Enqueue**: Pushes event to `Notification_Delivery_Queue`.

### Phase B: Delivery Execution (Notification Service)
A dedicated Worker consumes the queue.
1.  **Fetch**: Reads full error details from `Notification_Log`.
2.  **Route**: Checks `Notification_Config` to see user preferences (Email vs Slack).
3.  **Send**: Calls **Novu API** to trigger the workflow.
4.  **Ack**: Updates `Notification_Log` to status = `SENT`.

## 3. Classification Strategy
| Error Type | Audience | Example |
| :--- | :--- | :--- |
| **Validation** | CUSTOMER | "Missing Vendor Name" |
| **Mapping** | CUSTOMER | "Unknown Currency Code" |
| **Auth** | SUPPORT | "QuickBooks Token Expired" |
| **System** | SUPPORT | "Timeout / 500 Error" |

## 4. Database Schema

### Table: `Notification_Log`
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID | Primary Key |
| `tenant_id` | UUID | Context |
| `error_code` | Varchar | e.g. "VAL_ERR_01" |
| `target_audience` | Enum | `CUSTOMER`, `SUPPORT` |
| `status` | Enum | `PENDING`, `SENT`, `FAILED` |
| `payload` | JSONB | Full error context |
## 5. Flow Code Sample

### Phase A1: The Application Developer Experience
Simple, context-aware call. No need to pass tenant_id or record details manually.

```typescript
// apps/worker/src/integrations/quickbooks/outbound/vendor.ts
import { Notify } from '@fluxnex/core';

export async function CreateQBVendorGatewayRecord(vendor) {
   if (!vendor.name) {
       // SIMPLE CALL
       await Notify("Vendor Name is missing", "HIGH");
       throw new BusinessError("Validation Failed");
   }
}
```

### Phase A2: The Platform Wrapper (Infrastructure)
The Platform wraps the execution of the handler to inject context.

```typescript
// packages/core/src/pipeline/layer4_outbound/worker.ts
import { AsyncLocalStorage } from 'async_hooks';

const context = new AsyncLocalStorage();

export async function Notify(message: string, severity: string) {
    const ctx = context.getStore();
    // Platform automatically injects TenantID, RecordID, Audience
    await NotificationService.captureError({
       tenantId: ctx.tenantId,
       recordId: ctx.recordId,
       message: message,
       severity: severity,
       audience: 'CUSTOMER' // Default or derived from severity
    });
}

// Platform Worker Loop
async function processMessage(job: Job) {
   // 1. Resolve Tenant Context
   const { tenantId } = job.data;
   
   // 2. GET TENANT DB CONNECTION (Platform Awareness)
   // The Platform looks up the catalog, finds the connection string, and provides an isolated client.
   const tenantDb = await ConnectionManager.getTenantClient(tenantId);

   context.run({ tenantId, db: tenantDb }, async () => {
       try {
           const handler = Registry.getOutbound(dest);
           // Handler uses the injected 'db' (Schema is identical, data is isolated)
           await handler(record);
       } catch (e) {
           // Handle error
       }
   });
}
```

### Phase B: Consumer await (Notification Worker)
This runs independently to process alerts.

```typescript
// apps/worker/src/notification/worker.ts
import { Novu } from '@novu/node'; 
import { db } from '@fluxnex/core';

async function processNotification(job: Job) {
  const { logId } = job.data;

  // 1. FETCH DETAILS
  const log = await db.notificationLog.findUnique({ where: { id: logId } });
  if (!log || log.status === 'SENT') return;

  // 2. SEND VIA NOVU
  await novu.trigger('validation-error-workflow', {
    to: { subscriberId: log.tenantId },
    payload: {
      message: log.payload.message,
      record_id: log.payload.recordId
    }
  });

  // 3. ACKNOWLEDGE
  await db.notificationLog.update({
    where: { id: logId },
    data: { status: 'SENT' }
  });
}
```

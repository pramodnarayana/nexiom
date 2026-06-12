# Architecture: Activepieces Triggers for Soopa

In the Activepieces ecosystem, a **Trigger** is a specialized piece of code that detects a change in a source system. For Soopa, we use these triggers to feed our **Source Gateway (Layer 1)** and initialize our **Universal Replicas (Layer 2)**.

---

## 1. The Two Types of Triggers

Activepieces (and consequently Soopa) categorizes triggers into two technical patterns:

### A. Webhook Triggers (Push)

Used for real-time events. The source app (e.g., Stripe, Shopify) sends data to our `api-gateway` the moment an event occurs.

- **Soopa Mapping:** Maps to `POST /webhooks/:connectionId`.
- **AP Framework Advantage:** Includes `onEnable` and `onDisable` hooks. When a user creates a Route, Soopa can automatically call the Salesforce API to "subscribe" to a webhook, and "unsubscribe" when the route is deleted.

### B. Polling Triggers (Pull)

Used for apps that don't support webhooks or for enterprise objects (e.g., Salesforce Accounts). The system "polls" the API every N minutes to look for new or updated records.

- **Soopa Mapping:** Maps to the `PollerService` cron schedule (runs every 5 minutes via `@nestjs/schedule`).
- **AP Framework Advantage:** Handles the cursor logic. It remembers the last ID or timestamp seen so it doesn't fetch the same data twice.

---

## 2. The Piece Trigger Structure

When you "borrow" a piece from Activepieces, the trigger file (e.g., `salesforce/triggers/new-record.ts`) looks like this:

```typescript
export const newRecordTrigger = createTrigger({
  name: 'new_record',
  displayName: 'New Record',
  type: TriggerStrategy.POLLING, // or WEBHOOK
  props: {
    object: salesforceObjectProperty, // Reuse the Dynamic Object Discovery we built!
  },
  // Runs every time the poller executes
  async run(context) {
    const { store, propsValue, auth } = context;
    const lastTimestamp = await store.get('last_timestamp');

    // 1. Fetch data from Source API
    const records = await fetchFromSF(auth, propsValue.object, lastTimestamp);

    // 2. Update the Cursor (Store)
    await store.put('last_timestamp', new Date().toISOString());

    return records;
  },
});
```

---

## 3. How Soopa Integrates Triggers

We do not use the Activepieces workflow runner. Instead, we use the trigger definitions to populate our Gateway Tables.

| Trigger Event | Soopa Physical Action |
|---------------|------------------------|
| Webhook Hits  | The `WebhooksController` invokes `TriggerExecutorService.runWebhook()`, which verifies the signature, calls `trigger.run()`, and saves results to `ws_source.inbound_gateway`. |
| Poller Runs   | `PollerService` invokes `TriggerExecutorService.runPoll()`, which acquires a distributed lock, calls `trigger.run()`, ingests records idempotently into `ws_source.inbound_gateway`, and routes failures to the DLQ. |

---

## 4. Implementation Strategy for Soopa

To make triggers "seamless" like the actions we previously implemented:

1. **Trigger Registry:** Use `getTrigger(appName, triggerName)` from `PieceRegistryService` in `apps/api`. Trigger definitions live in `@soopa/connections` (under `packages/connections/src/apps/`) and are registered at startup via `REGISTERED_PIECES`.
2. **The Poller Kernel:** `PollerService` in `apps/api/src/modules/trigger/poller.service.ts` handles polling. It:
   - Queries all active connections with a registered Polling trigger (keyset-paginated).
   - Invokes `TriggerExecutorService.runPoll()` which calls the piece's `run()` function.
   - Maps the output into your Layer 1 `inbound_gateway` table via idempotent insert.
3. **The Webhook Router:** Create a single endpoint `POST /webhooks/:connectionId`.
   - Look up the `connectionId` to find the `appName`.
   - Execute the webhook logic from the Piece definition.

---

## 5. Summary: Why Borrow AP Triggers?

- **Automatic Webhook Management:** You don't have to manually write code to register webhooks in Salesforce; the Piece code already knows the "Subscription API" for you.
- **Standardized Cursors:** You get a battle-tested way to handle pagination and "last modified" timestamps across 200+ apps.

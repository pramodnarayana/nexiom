# Architecture: Activepieces Trigger Integration

This document defines how Nexiom hosts and executes Activepieces Triggers to power our **Source Gateway (Layer 1)**.

---

## 1. The Trigger Framework Bridge

Activepieces triggers are more complex than actions because they have a lifecycle (`onEnable`, `onDisable`) and maintain state (Cursors). We bridge these into our kernel via the `TriggerExecutorService`.

### Lifecycle Mapping

| AP Trigger Lifecycle | Nexiom Action |
|----------------------|---------------|
| `onEnable`           | Triggered when a Route is activated. Used to register webhooks in the source app (e.g., Salesforce). |
| `onDisable`          | Triggered when a Route is deleted/disabled. Unregisters the webhook. |
| `run` (Polling)      | Triggered by our internal Scheduler. Fetches new data since the last cursor. |
| `run` (Webhook)      | Triggered by our `api-gateway` listener. Standardizes the raw HTTP request into a record. |

---

## 2. Technical Flow

### A. Polling Strategy (The Pull Engine)

1. **Scheduler:** `PollerService` in `apps/api` runs a cron every 5 minutes (via `@nestjs/schedule`). It queries all active connections that have a registered Polling trigger.
2. **Context:** `TriggerExecutorService` acquires a per-(workspace, trigger) Redis lock, then builds a `TriggerContext` whose `store` reads/writes the trigger's cursor from a Redis Hash keyed as `cursor:{workspaceId}:{appName}:{objectType}:{triggerName}`. Current polling triggers use concrete cursor keys: `last_created_cursor` (New Record) and `last_modified_cursor` (Updated Record). New polling triggers should adopt the same `last_{field}_cursor` convention.
3. **Execution:** The Piece's `run()` function is executed. It reads the cursor from `context.store`, calls the upstream API, and returns an array of new records.
4. **Ingestion:** Each record is idempotently saved into the `inbound_gateway` table (via `ON CONFLICT DO NOTHING`). After each successful insert the cursor advances to the record's own source timestamp.

### B. Webhook Strategy (The Push Engine)

1. **Ingestor:** A generic endpoint `POST /webhooks/:connectionId` receives a request.
2. **Hand-off:** The Piece's webhook handler processes the headers/body (validating signatures).
3. **Ingestion:** The standardized payload is saved to `inbound_gateway`.

---

## 3. Directory Structure

The package (`packages/connections`, to be renamed `packages/connectors`) is split into four clear layers:

```
packages/connections/src/
│
├── framework/                  # AP compatibility SDK
│   ├── action.ts               # createAction, Action, ActionContext
│   ├── trigger.ts              # createTrigger, Trigger, TriggerStore, TriggerStrategy
│   ├── piece.ts                # createPiece, Piece
│   ├── property.ts             # Property, PropertyType
│   ├── auth.ts                 # PieceAuth
│   ├── http-client.ts          # HostHttpClient
│   └── index.ts
│
├── apps/                       # One folder per integration (Activepieces layout)
│   ├── salesforce/
│   │   ├── actions/            # (future)
│   │   ├── triggers/           # 👈 Adapted from Activepieces
│   │   │   ├── new-record.ts
│   │   │   └── updated-record.ts
│   │   └── index.ts            # Exports the Salesforce Piece definition
│   └── quickbooks/
│       └── index.ts
│
├── oauth/                      # OAuth runtime infrastructure
│   ├── types.ts                # ProviderDefinition, OAuth2Provider, etc.
│   ├── provider-registry.ts    # ProviderRegistryService
│   ├── token-manager.service.ts
│   └── providers/
│       ├── salesforce.ts       # OAuth URLs + scopes
│       ├── quickbooks.ts
│       └── index.ts            # PROVIDER_REGISTRY map
│
├── crypto/                     # Encryption utilities
│   └── encryption.service.ts
│
└── index.ts                    # Root barrel — re-exports all layers
```

---

## 4. Why This Is Enterprise Grade

- **Cursor Integrity:** By using AP's standardized `store.get`/`store.put` interface, we ensure that if a poller fails halfway through, the cursor isn't updated, preventing data loss.
- **Webhook Cleanliness:** Standardized `onDisable` hooks prevent "Ghost Webhooks" from continuing to hit our server after a customer deletes a connection.
- **Dynamic Objects:** Reuses the Object Discovery logic we built, allowing the user to select which Salesforce object triggers the route.

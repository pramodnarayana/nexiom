# Engine Application — Integration Domain

Vendor-aware integration logic. **This code knows *what* data means** in
Nexiom's business domain. It uses `engine/platform/` primitives and
`packages/` infrastructure to implement actual integration behaviour.

## Sub-packages (current and planned)

| Directory | Package | Status | Description |
|:---|:---|:---|:---|
| `mapping/` | `@soopa/mapping` | **Active (T022B)** | MappingEngine — builds target JSON from Mapping Config + Stitch Config |
| `pieces/` | `@soopa/pieces` | Migrating (T055 Ph3) | Salesforce + QuickBooks piece implementations |
| `parsers/` | `@soopa/parsers` | Planned (T055 Ph3) | App Parsers — Zod schemas per vendor (L2) |
| `canonical/` | `@soopa/canonical` | Planned (T055 Ph3) | Canonical Model schemas (`TMS_VENDOR`, `CONTACT`, `INVOICE`) |
| `connectors/` | `@soopa/connectors` | Migrating (T055 Ph3) | OAuth flows, vendor HTTP client, credential crypto |

## What belongs here

- Vendor-specific trigger validation (Salesforce HMAC, QuickBooks webhook)
- App Parsers: Zod schemas that extract structured fields from raw vendor JSON
- Canonical Model definitions: what `TMS_VENDOR` means, what `CONTACT` means
- `MappingEngine`: reads Mapping Config + Stitch Config, produces target JSON
- Formula Library: `dateFormat`, `concat`, `unitConvert`, `coalesce`
- Config Applicator: `useTaxCode`, `currencyOverride` behavioral flags
- Vendor-specific `run()` implementations (`quickbooks.create_invoice`)
- OAuth flows and vendor HTTP client helpers

## What does NOT belong here

- Generic execution primitives (path traversal, state machines, rule engines)
  → those belong in `engine/platform/`

- Infrastructure (queue, database, cache, auth)
  → those belong in `packages/`

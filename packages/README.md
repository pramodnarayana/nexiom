# Infrastructure Packages

> **This is commodity infrastructure — not the core product.**

These packages provide the plumbing that enables the Nexiom Sync Engine to
run. They are generic, reusable, and have **zero knowledge** of stitches,
field mappings, vendor connections, or sync business rules.

For the core Nexiom product code, see [`engine/`](../engine/README.md).

---

## Packages

| Package | Purpose |
|:---|:---|
| `queue/` | Generic SQS/BullMQ messaging client |
| `database/` | Drizzle schema definitions + migration runner |
| `cache/` | Redis client wrapper |
| `infra-adapters/` | AWS KMS encryption/decryption, crypto utilities |
| `auth/` | JWT session management, auth guards |
| `identity/` | Tenant and organisation management |
| `dbmanager/` | Workspace schema provisioner (`ws_{id}` plans) |
| `eslint-config/` | Shared ESLint configuration |

## Rule

These packages **must never import** from `engine/`. They are not allowed to
know about integration domain concepts (`StitchConfig`, `MappingRule`,
`replica_entity`, etc.).

If you find yourself importing an engine concept into a `packages/` package,
the code belongs in `engine/platform/` instead.

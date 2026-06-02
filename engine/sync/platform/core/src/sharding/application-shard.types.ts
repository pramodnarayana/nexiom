import type { NormalizedRecord } from '@nexiom/piece-framework';

// ---------------------------------------------------------------------------
// ApplicationShardModule — the contract every application shard must satisfy.
//
// @deprecated
// This interface has been extracted to @nexiom/piece-framework to fix an
// abstraction leak. Do not delete this file yet! It remains here temporarily
// to ensure backward compatibility for the platform core until end-to-end
// testing of the new app-connectors repository is complete.
export type { 
  ApplicationShardModule, 
  WebhookResponseShape,
  NormalizedRecord
} from '@nexiom/piece-framework';

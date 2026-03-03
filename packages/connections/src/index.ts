/**
 * @nexiom/connections — public API
 *
 * BREAKING CHANGE (v2.0.0): The `connectivity/` directory was renamed to `oauth/`.
 * Update any direct deep-imports:
 *
 *   Before (v1.x):                           After (v2.x):
 *   import ... from '.../connectivity/types'  import ... from '.../oauth/types.js'
 *   import ... from '.../connectivity/token-manager.service'
 *                                    ➜  import ... from '.../oauth/token-manager.service.js'
 *   import ... from '.../connectivity/provider-registry'
 *                                    ➜  import ... from '.../oauth/provider-registry.js'
 *
 * All named exports remain identical — no call-site changes are required beyond
 * updating the import path.
 */

// OAuth runtime infrastructure
export * from './oauth/types.js';
export * from './oauth/token-manager.service.js';
export * from './oauth/provider-registry.js';

// Crypto utilities
export * from './crypto/encryption.service.js';

// Framework — Piece, Action, Trigger, Auth, Property definitions
export * from './framework/index.js';

export { salesforce as salesforcePiece } from '@activepieces/piece-salesforce';

// The upstream displayName is "Quickbooks Online" which auto-derives to "quickbooks-online".
// Pin the name to 'quickbooks' so DB app_name lookups remain stable.
import { quickbooks as _quickbooks } from '@activepieces/piece-quickbooks';
import type { Piece } from './framework/piece.js';
export const quickbooksPiece: Piece = { ...(_quickbooks as unknown as Piece), name: 'quickbooks' };

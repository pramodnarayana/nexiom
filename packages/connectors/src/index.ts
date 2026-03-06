/**
 * @nexiom/connectors — public API
 *
 * BREAKING CHANGE (v2.0.0): The package has been refactored.
 * Update imports to use the public exported entrypoints:
 *
 *   - `@nexiom/connectors`
 *   - `@nexiom/connectors/framework`
 *   - `@nexiom/connectors/intelligence`
 *
 * Subpath imports (like `/oauth/types.js`) are no longer exposed. All
 * previously deep-imported symbols are available directly via the root or framework entrypoints.
 */

// OAuth runtime infrastructure
export * from './oauth/types.js';
export * from './oauth/token-manager.service.js';
export * from './oauth/provider-registry.js';

// Crypto utilities
export * from './crypto/encryption.service.js';

// Framework — Piece, Action, Trigger, Auth, Property definitions
export * from './framework/index.js';

// Registered app Pieces — one export per integrated app
export { salesforcePiece } from './apps/salesforce/index.js';

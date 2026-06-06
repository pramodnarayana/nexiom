/**
 * @soopa/credentials — public API
 *
 * Entrypoints:
 *   - `@soopa/credentials`           — runtime services (encryption, token manager)
 *   - `@soopa/piece-framework` — piece/action/trigger/auth/property definitions
 */

// Crypto utilities
export * from './crypto/encryption.interface.js';
export * from './crypto/encryption.service.js';

// Token management (OAuth refresh, credential storage)
export * from './oauth/token-manager.service.js';
export * from './oauth/token-refresh.service.js';
export * from './oauth/redis-lock.js';

// Events
export * from './events/index.js';
export * from './interfaces/event-publisher.interface.js';
export * from './services/credentials-event-publisher.service.js';



/**
 * @deprecated The ProviderRegistry and dynamic `OAuthProvider` architectures have been removed in favor of the `PieceRegistry` flow.
 * These types are exported merely as aliases for backwards compatibility.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Provider { }
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface OAuthProvider { }
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class SalesforceConnector { }

export * from "./http-client/host-http-client.js";

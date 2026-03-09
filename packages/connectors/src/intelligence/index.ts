export * from './igt-logger.js';
export * from './interfaces.js';
export * from './optimization-registry.js';
export * from './smart-cursor-selector.js';
export * from './universal-trigger-engine.js';

/**
 * @deprecated Salesforce-specific helper functions have been moved to the Salesforce Piece itself (`@nexiom/piece-salesforce`).
 * These legacy exports are stubbed out for backwards compatibility. Do not use.
 */
export const SalesforcePollingHelper = {} as unknown;
export const SalesforceQueryAdapter = {} as unknown;
export const SalesforceSFUtils = {} as unknown;


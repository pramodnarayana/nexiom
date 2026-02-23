import { ProviderDefinition } from '../types.js';
import { salesforceProvider } from './salesforce.provider.js';
import { quickbooksProvider } from './quickbooks.provider.js';

/**
 * Central in-memory provider registry — add new providers here.
 * Auth configs are derived from activepieces-reference pieces.
 * API action code (createLead, createInvoice, etc.) lives in the
 * integrations/* packages and is a separate concern.
 */
export const PROVIDER_REGISTRY: Record<string, ProviderDefinition> = {
    salesforce: salesforceProvider,
    quickbooks: quickbooksProvider,
};

export { salesforceProvider } from './salesforce.provider.js';
export { quickbooksProvider } from './quickbooks.provider.js';
export type { ProviderDefinition } from '../types.js';

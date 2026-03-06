import { ProviderDefinition } from '../types.js';
import { salesforceProvider } from './salesforce.js';
import { quickbooksProvider } from './quickbooks.js';

export type ProviderName = 'salesforce' | 'quickbooks';

/**
 * Central in-memory provider registry — add new providers here.
 * Auth configs are derived from activepieces-reference pieces.
 * API action code (createLead, createInvoice, etc.) lives in the
 * integrations/* packages and is a separate concern.
 */
export const PROVIDER_REGISTRY: Record<ProviderName, ProviderDefinition> = {
    salesforce: salesforceProvider,
    quickbooks: quickbooksProvider,
};

export { salesforceProvider } from './salesforce.js';
export { quickbooksProvider } from './quickbooks.js';
export type { ProviderDefinition } from '../types.js';

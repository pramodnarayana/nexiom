/**
 * Registry of all officially supported integration providers.
 * As the system scales to 500+ integrations, this Set ensures O(1) validation lookups.
 * New providers should be added here when their integration packages are built.
 */
export const ALLOWED_PROVIDERS = new Set<string>([
    'salesforce',
    'quickbooks'
]);

/**
 * Shared Salesforce type definitions.
 *
 * This module is the neutral location for types that are used by both the
 * trigger layer and the intelligence adapters, avoiding circular dependencies
 * and coupling between layers.
 */

/** Represents a valid Salesforce OAuth credential set. */
export interface SalesforceAuth {
    access_token: string;
    instance_url: string;
}

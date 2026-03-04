import type { SalesforceAuth } from '../apps/salesforce/triggers/salesforce-polling.helper.js';

export interface FieldDescriptor {
    name: string;
    type: string;          // 'string' | 'datetime' | 'reference' | 'currency' | …
    filterable: boolean;
    sortable: boolean;
    nillable: boolean;
    referenceTo?: string[];
}

export interface ChildRelationshipDescriptor {
    relationshipName: string;  // e.g. 'OpportunityLineItems'
    childSObject: string;      // e.g. 'OpportunityLineItem'
    field: string;             // FK field on the child
}

export interface ObjectSchema {
    objectName: string;
    fields: FieldDescriptor[];
    childRelationships: ChildRelationshipDescriptor[];
    fetchedAt: number;  // Date.now() — for TTL expiry
}

export class DiscoveryService {
    private readonly cache = new Map<string, ObjectSchema>();
    private readonly TTL_MS = 15 * 60 * 1000; // 15 minutes

    /**
     * Returns the live schema for the given Salesforce object.
     * Calls /sobjects/{object}/describe; caches for 15 minutes.
     * Auth shape matches SalesforceAuth from salesforce-polling.helper.ts.
     */
    async describe(auth: SalesforceAuth, objectName: string): Promise<ObjectSchema> {
        const cached = this.cache.get(objectName);
        if (cached && (Date.now() - cached.fetchedAt < this.TTL_MS)) {
            return cached;
        }

        const url = `${auth.instance_url}/services/data/v59.0/sobjects/${objectName}/describe`;
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json' },
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Salesforce DiscoveryService describe failed (${response.status}): ${text}`);
        }

        const body = await response.json();

        const schema: ObjectSchema = {
            objectName,
            fields: body.fields.map((f: any) => ({
                name: f.name,
                type: f.type,
                filterable: f.filterable,
                sortable: f.sortable,
                nillable: f.nillable,
                referenceTo: f.referenceTo?.length > 0 ? f.referenceTo : undefined,
            })),
            childRelationships: (body.childRelationships || [])
                .filter((rel: any) => rel.relationshipName)
                .map((rel: any) => ({
                    relationshipName: rel.relationshipName,
                    childSObject: rel.childSObject,
                    field: rel.field,
                })),
            fetchedAt: Date.now(),
        };

        this.cache.set(objectName, schema);
        return schema;
    }

    /**
     * Validates that the cursor field still exists in the live schema.
     * Called before every poll run as a lightweight schema drift check.
     */
    async fieldExists(auth: SalesforceAuth, objectName: string, fieldName: string): Promise<boolean> {
        try {
            const schema = await this.describe(auth, objectName);
            return schema.fields.some(f => f.name === fieldName);
        } catch (error) {
            console.debug(`Failed to fetch schema for ${objectName}:`, error);
            return false;
        }
    }

    /** Invalidate cached schema (call after a DEGRADED mapping is repaired). */
    invalidate(objectName: string): void {
        this.cache.delete(objectName);
    }
}

export const discoveryService = new DiscoveryService();

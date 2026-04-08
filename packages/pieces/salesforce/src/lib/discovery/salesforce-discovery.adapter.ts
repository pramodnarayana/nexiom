import type { TriggerStore } from '@nexiom/piece-framework';
import {
    type IDiscoveryAdapter,
    type ObjectSchema,
    IgtLogger,
} from '@nexiom/piece-framework/discovery';
import { SalesforceAuthError, sfFetch } from '../sf-fetch.js';
import { SF_API_VERSION } from '../common/index.js';
import type { SalesforceAuth } from '../salesforce-types.js';

const STORE_SCHEMA_KEY_PREFIX = 'igt_schema_';
const log = new IgtLogger({ app: 'salesforce' });

export class SalesforceDiscoveryAdapter implements IDiscoveryAdapter<SalesforceAuth> {
    private readonly cache = new Map<string, ObjectSchema>();
    private readonly TTL_MS = 15 * 60 * 1000; // 15 minutes

    private readonly MAX_CACHE_SIZE = 100;

    async describe(auth: SalesforceAuth, objectName: string, store?: TriggerStore): Promise<ObjectSchema> {

        const memKey = `${auth.instance_url}:${objectName}`;
        const storeKey = `${STORE_SCHEMA_KEY_PREFIX}${auth.instance_url}:${objectName}`;

        // Tier 1 — in-memory
        const cached = this.cache.get(memKey);
        if (cached) {
            if (Date.now() - cached.fetchedAt < this.TTL_MS) {
                return cached;
            }
            this.cache.delete(memKey); // Lazy expiration
        }

        // Tier 2 — persistent store (survives pod restarts)
        if (store) {
            const stored = await store.get<ObjectSchema>(storeKey).catch((err) => {
                log.error('store.get failed during schema discovery', { storeKey, error: String(err) });
                return null;
            });
            if (stored && (Date.now() - stored.fetchedAt < this.TTL_MS)) {
                this.enforceCacheSizeLimit();
                this.cache.set(memKey, stored); // warm in-memory tier
                return stored;
            }
        }

        // Tier 3 — live Salesforce API
        log.debug('Fetching schema from Salesforce API', { object: objectName });
        if (!/^\w+$/.test(objectName)) {
            throw new Error(`Invalid Salesforce object name: ${objectName}`);
        }

        const body = await this.fetchSchemaFromSource(auth, objectName);


        const schema: ObjectSchema = {
            objectName,
            fields: Array.isArray(body.fields) ? body.fields.map((f: any) => ({
                name: f.name,
                type: f.type,
                filterable: f.filterable,
                sortable: f.sortable,
                nillable: f.nillable,
                referenceTo: f.referenceTo?.length > 0 ? f.referenceTo : undefined,
            })) : [],
            childRelationships: Array.isArray(body.childRelationships) ? body.childRelationships
                .filter((rel: any) => rel.relationshipName)
                .map((rel: any) => ({
                    relationshipName: rel.relationshipName,
                    childSObject: rel.childSObject,
                    field: rel.field,
                })) : [],
            fetchedAt: Date.now(),
        };

        // Write to both cache tiers
        this.enforceCacheSizeLimit();
        this.cache.set(memKey, schema);
        if (store) {
            await store.put(storeKey, schema).catch((err) => {
                log.error('Failed to write schema to store cache', { object: objectName, storeKey, error: String(err) });
            });
        }

        log.debug('Schema cached', { object: objectName, fields: String(schema.fields.length) });
        return schema;
    }

    private enforceCacheSizeLimit(): void {
        if (this.cache.size >= this.MAX_CACHE_SIZE) {
            // Map iteration respects insertion order; the first key is the oldest
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) {
                this.cache.delete(oldestKey);
            }
        }
    }

    async fieldExists(auth: SalesforceAuth, objectName: string, fieldName: string, store?: TriggerStore): Promise<boolean> {
        try {
            const schema = await this.describe(auth, objectName, store);
            return schema.fields.some(f => f.name === fieldName);
        } catch (error) {
            if (error instanceof SalesforceAuthError) throw error;
            if (error instanceof Error && error.message.includes('[FieldNotFoundError]')) {
                log.debug('Object or field not found during drift check', { object: objectName, field: fieldName });
                return false;
            }
            throw error;
        }
    }

    invalidate(auth: SalesforceAuth, objectName: string, store?: TriggerStore): void {
        this.cache.delete(`${auth.instance_url}:${objectName}`);
        if (store) {
            store.delete(`${STORE_SCHEMA_KEY_PREFIX}${auth.instance_url}:${objectName}`).catch(() => { });
        }
    }

    private async fetchSchemaFromSource(auth: SalesforceAuth, objectName: string): Promise<any> {
        const encodedObject = encodeURIComponent(objectName.trim());
        const url = `${auth.instance_url}/services/data/${SF_API_VERSION}/sobjects/${encodedObject}/describe`;

        try {
            const response = await sfFetch(url, {
                headers: { Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json' },
            });
            return await response.json();
        } catch (e: any) {
            if (e instanceof SalesforceAuthError) {
                throw e;
            }
            const errMsg = String(e.message || e);
            const isMissingField = errMsg.includes('(404)') || errMsg.includes('No such field') || errMsg.includes('NOT_FOUND');
            if (isMissingField) {
                throw new Error(`[FieldNotFoundError] Salesforce describe failed for ${objectName}: ${errMsg}`);
            }
            throw new Error(`Salesforce describe failed for ${objectName}: ${errMsg}`);
        }
    }
}

import { SmartCursorSelector } from './smart-cursor-selector.js';
import { IgtLogger } from './igt-logger.js';
import type { UniversalEngineConfig } from './interfaces.js';
import { checkSalesforceLimits } from '../apps/salesforce/sf-fetch.js';

const log = new IgtLogger({ app: 'universal-engine' });

export class UniversalTriggerEngine {
    /**
     * Executes the generic, intelligent polling flow using the provided adapter configuration.
     */
    static async execute<TAuth = unknown>(config: UniversalEngineConfig<TAuth>): Promise<unknown[]> {
        const {
            objectName,
            hint,
            discoveryAdapter,
            queryAdapter,
            executeCountQuery
        } = config;

        // 1. Determine Identity & Configuration
        const bulkThreshold = hint?.bulkThreshold ?? 5_000;
        const lowLimitThreshold = process.env.SF_API_LIMIT_THRESHOLD ? Number.parseFloat(process.env.SF_API_LIMIT_THRESHOLD) : 0.2;

        // --- BACKOFF & PROTECTION LOGIC ---
        const isLimitSafe = await this.verifyApiLimitsSafe(config.auth, config.store, lowLimitThreshold, objectName);
        if (!isLimitSafe) return [];

        // 2. Discover / Warm Schema Cache
        const schema = await discoveryAdapter.describe(config.auth, objectName, config.store);

        // 3. Pick Best Cursor
        const cursorField = SmartCursorSelector.pick(schema, hint);

        // 4. Protect Against Schema Drift
        const driftOk = await discoveryAdapter.fieldExists(config.auth, objectName, cursorField, config.store);
        if (!driftOk) {
            log.error(`Cursor field ${cursorField} not found in live ${objectName} schema`);
            return []; // Fail gracefully, maybe trigger fallback or degraded mode
        }

        // 5. Build State & Checkpoint Keys
        const cursorKey = `igt_${objectName}_${cursorField}`;
        const stateStr = await config.store.get<string>(cursorKey);
        const { lastCursor, lastTieBreaker } = this.parseState(stateStr, schema, cursorField);

        log.debug('Polling engine active', { object: objectName, cursor: lastCursor });

        // 6. Preflight Size Estimation (If specific API supports it)
        let totalSize = -1;
        if (executeCountQuery && typeof queryAdapter.buildCountQuery === 'function') {
            const countSoql = queryAdapter.buildCountQuery(schema, {
                objectName,
                cursorField,
                cursorValue: lastCursor,
                autoJoins: hint?.autoJoin,
            });

            if (countSoql) {
                totalSize = await executeCountQuery(config.auth, countSoql);
                log.debug('Preflight count fetched', { objectName, count: String(totalSize) });
            }
        }

        let records: unknown[] = [];
        try {
            records = await this.fetchRecords(config, totalSize, bulkThreshold, lastCursor);
        } catch (e: any) {
            if (e.message?.includes('REQUEST_LIMIT_EXCEEDED')) {
                log.warn('Salesforce API limit exceeded (403). Backing off.', { objectName });
                return []; // Pause without advancing the cursor
            }
            throw e;
        }

        if (records.length > 0 && lastTieBreaker) {
            records = records.filter(rec => this.isRecordNewer(rec, cursorField, lastCursor, lastTieBreaker));
        }

        // 9. Checkpoint State
        await this.checkpointState(records, cursorField, cursorKey, lastCursor, config.store, objectName);

        return records;
    }

    private static async verifyApiLimitsSafe(
        auth: any,
        store: any,
        lowLimitThreshold: number,
        objectName: string
    ): Promise<boolean> {
        let apiLimits: { remaining: number; total: number } | null = null;
        try {
            apiLimits = await checkSalesforceLimits(auth, store);
        } catch (e) {
            log.debug('Failed to verify API limits during preflight cache check', { error: String(e) });
            return true; // Fail open
        }

        if (apiLimits && apiLimits.total > 0) {
            const ratio = apiLimits.remaining / apiLimits.total;
            if (ratio < lowLimitThreshold) {
                log.warn('Salesforce API Limit critically low — pausing poll', {
                    remaining: String(apiLimits.remaining),
                    total: String(apiLimits.total),
                    threshold: String(lowLimitThreshold),
                    objectName
                });
                return false;
            }
        }
        return true;
    }

    private static parseState(stateStr: string | null, schema: any, cursorField: string): { lastCursor: string, lastTieBreaker: string } {
        let lastCursor: string | undefined;
        let lastTieBreaker = '';

        if (stateStr) {
            const parts = stateStr.split('||');
            lastCursor = parts[0];
            lastTieBreaker = parts[1] ?? '';
        }

        if (lastCursor === null || lastCursor === undefined) {
            const fieldDef = schema.fields.find((f: any) => f.name === cursorField);
            const fieldType = fieldDef?.type?.toLowerCase() || 'string';

            if (['datetime', 'date', 'time'].includes(fieldType)) {
                lastCursor = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            } else if (['int', 'double', 'currency', 'percent', 'number', 'id', 'reference'].includes(fieldType)) {
                lastCursor = '0';
            } else {
                lastCursor = '';
            }
        }

        return { lastCursor, lastTieBreaker };
    }

    private static async fetchRecords(
        config: UniversalEngineConfig<any>,
        totalSize: number,
        bulkThreshold: number,
        lastCursor: string
    ): Promise<unknown[]> {
        const { objectName, hint, queryAdapter, bulkAdapter, executeStandardQuery, schema } = config as any;

        // 7. Route to Bulk API if threshold exceeded
        if (bulkAdapter && totalSize >= bulkThreshold) {
            log.info('Threshold exceeded, routing to Bulk API tier', { totalSize: String(totalSize) });
            const bulkQueryString = queryAdapter.buildQuery(schema, {
                objectName,
                cursorField: SmartCursorSelector.pick(schema, hint),
                cursorValue: lastCursor,
                autoJoins: hint?.autoJoin,
                omitLimit: true,
            });
            return bulkAdapter.runBulkJob(config.auth, bulkQueryString, config.store);
        } else if (totalSize === 0) {
            return []; // Avoid round-trip if preflight says 0 rows
        } else {
            // 8. Execute Standard HTTP Polling Loop
            const queryString = queryAdapter.buildQuery(schema, {
                objectName,
                cursorField: SmartCursorSelector.pick(schema, hint),
                cursorValue: lastCursor,
                autoJoins: hint?.autoJoin,
                limit: 2_000,
            });
            return executeStandardQuery(config.auth, queryString);
        }
    }

    private static isRecordNewer(rec: unknown, cursorField: string, lastCursor: string, lastTieBreaker: string): boolean {
        const val = String((rec as Record<string, unknown>)[cursorField]);
        const idRaw = (rec as Record<string, unknown>)['Id'] ?? (rec as Record<string, unknown>)['id'];
        const tb = typeof idRaw === 'string' || typeof idRaw === 'number' ? String(idRaw) : '';
        return val > lastCursor || (val === lastCursor && tb > lastTieBreaker);
    }

    private static async checkpointState(
        records: unknown[],
        cursorField: string,
        cursorKey: string,
        lastCursor: string,
        store: any,
        objectName: string
    ): Promise<void> {
        // MAX across all records — safe against out-of-order results and timestamp ties
        let maxCursor: string | undefined;
        let maxTieBreaker: string | undefined;

        for (const rec of records) {
            const val = String((rec as Record<string, unknown>)[cursorField]);
            const idRaw = (rec as Record<string, unknown>)['Id'] ?? (rec as Record<string, unknown>)['id'];
            const tieBreaker = typeof idRaw === 'string' || typeof idRaw === 'number' ? String(idRaw) : '';

            if (!maxCursor || val > maxCursor || (val === maxCursor && tieBreaker > (maxTieBreaker ?? ''))) {
                maxCursor = val;
                maxTieBreaker = tieBreaker;
            }
        }

        if (maxCursor) {
            const compositeCursor = maxTieBreaker ? `${maxCursor}||${maxTieBreaker}` : maxCursor;
            await store.put(cursorKey, compositeCursor);
            log.info('Cursor advanced', { objectName, cursor: maxCursor, tieBreaker: maxTieBreaker });
        } else {
            log.debug('No new records, cursor retained', { objectName, cursor: lastCursor });
        }
    }
}

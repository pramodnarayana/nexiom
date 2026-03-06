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
        const lowLimitThreshold = this.parseLimitThreshold(process.env.SF_API_LIMIT_THRESHOLD);

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

        log.debug('Polling engine active', { object: objectName, cursor: String(lastCursor) });

        const fieldDef = schema.fields.find((f: any) => f.name === cursorField);
        const fieldType = fieldDef?.type || 'string';
        const queryCursorValue = this.formatForQuery(lastCursor, fieldType);

        // 6. Preflight Size Estimation (If specific API supports it)
        let totalSize = -1;
        if (executeCountQuery && typeof queryAdapter.buildCountQuery === 'function') {
            const countSoql = queryAdapter.buildCountQuery(schema, {
                objectName,
                cursorField,
                cursorValue: String(queryCursorValue),
                autoJoins: hint?.autoJoin,
                tieBreakerField: 'Id',
                tieBreakerValue: lastTieBreaker || undefined,
            });

            if (countSoql) {
                try {
                    totalSize = await executeCountQuery(config.auth, countSoql);
                    log.debug('Preflight count fetched', { objectName, count: String(totalSize) });
                } catch (e: any) {
                    log.error('Preflight count query failed', { objectName, error: String(e.message || e) });
                    totalSize = -1;
                }
            }
        }

        let records: unknown[] = [];
        try {
            records = await this.fetchRecords(config, schema, totalSize, bulkThreshold, lastCursor, cursorField, lastTieBreaker);
        } catch (e: any) {
            if (e.message?.includes('REQUEST_LIMIT_EXCEEDED')) {
                log.warn('Salesforce API limit exceeded (403). Backing off.', { objectName });
                return []; // Pause without advancing the cursor
            }
            throw e;
        }

        if (records.length > 0 && lastTieBreaker) {
            records = records.filter(rec => this.isRecordNewer(rec, cursorField, lastCursor, lastTieBreaker, schema));
        }

        // 9. Checkpoint State
        await this.checkpointState(records, cursorField, cursorKey, lastCursor, config.store, objectName, schema);

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

    private static parseLimitThreshold(envValue?: string): number {
        if (!envValue) return 0.2;
        const parsed = Number.parseFloat(envValue);
        if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return 0.2;
        return Math.max(0, Math.min(1, parsed));
    }

    private static parseState(stateStr: string | null, schema: any, cursorField: string): { lastCursor: string | number, lastTieBreaker: string } {
        let lastCursor: string | number | undefined;
        let lastTieBreaker = '';

        const fieldDef = schema.fields.find((f: any) => f.name === cursorField);
        const fieldType = fieldDef?.type || 'string';

        if (stateStr) {
            const parts = stateStr.split('||');
            lastCursor = this.toTypedCursor(parts[0], fieldType);
            lastTieBreaker = parts[1] ?? '';
        }

        if (lastCursor === null || lastCursor === undefined) {
            const ft = fieldType.toLowerCase();
            if (['datetime', 'date', 'time'].includes(ft)) {
                lastCursor = Date.now() - 24 * 60 * 60 * 1000;
            } else if (['int', 'double', 'currency', 'percent', 'number', 'id', 'reference'].includes(ft)) {
                lastCursor = 0;
            } else {
                lastCursor = '';
            }
        }

        return { lastCursor, lastTieBreaker };
    }

    private static toTypedCursor(val: any, fieldType: string): string | number {
        if (val === null || val === undefined) return '';
        const ft = fieldType.toLowerCase();
        if (['datetime', 'date', 'time'].includes(ft)) {
            const valStr = String(val);
            if (/^\d+$/.test(valStr)) {
                return Number(valStr);
            }
            const parsed = Date.parse(valStr);
            return Number.isNaN(parsed) ? valStr : parsed;
        } else if (['int', 'double', 'currency', 'percent', 'number'].includes(ft)) {
            const parsed = Number(val);
            return Number.isNaN(parsed) ? String(val) : parsed;
        }
        return String(val);
    }

    private static formatForQuery(val: string | number, fieldType: string): string | number {
        const ft = fieldType.toLowerCase();
        if (['datetime', 'date', 'time'].includes(ft) && typeof val === 'number') {
            return new Date(val).toISOString();
        }
        return val;
    }

    private static async fetchRecords(
        config: UniversalEngineConfig<any>,
        schema: any,
        totalSize: number,
        bulkThreshold: number,
        lastCursor: string | number,
        cursorField: string,
        lastTieBreaker: string
    ): Promise<unknown[]> {
        const { objectName, hint, queryAdapter, bulkAdapter, executeStandardQuery } = config as any;
        const fieldDef = schema.fields.find((f: any) => f.name === cursorField);
        const fieldType = fieldDef?.type || 'string';
        const queryCursorValue = this.formatForQuery(lastCursor, fieldType);

        // 7. Route to Bulk API if threshold exceeded
        if (bulkAdapter && totalSize >= bulkThreshold) {
            log.info('Threshold exceeded, routing to Bulk API tier', { totalSize: String(totalSize) });
            const bulkQueryString = queryAdapter.buildQuery(schema, {
                objectName,
                cursorField,
                cursorValue: String(queryCursorValue),
                autoJoins: hint?.autoJoin,
                omitLimit: true,
                tieBreakerField: 'Id',
                tieBreakerValue: lastTieBreaker || undefined,
            });
            return bulkAdapter.runBulkJob(config.auth, bulkQueryString, config.store);
        } else if (totalSize === 0) {
            return []; // Avoid round-trip if preflight says 0 rows
        } else {
            // 8. Execute Standard HTTP Polling Loop
            const queryString = queryAdapter.buildQuery(schema, {
                objectName,
                cursorField,
                cursorValue: String(queryCursorValue),
                autoJoins: hint?.autoJoin,
                limit: 2_000,
                tieBreakerField: 'Id',
                tieBreakerValue: lastTieBreaker || undefined,
            });
            return executeStandardQuery(config.auth, queryString);
        }
    }

    private static isRecordNewer(rec: unknown, cursorField: string, lastCursor: string | number, lastTieBreaker: string, schema: any): boolean {
        const fieldDef = schema.fields.find((f: any) => f.name === cursorField);
        const fieldType = fieldDef?.type || 'string';
        const val = this.toTypedCursor((rec as Record<string, unknown>)[cursorField], fieldType);

        const idRaw = (rec as Record<string, unknown>)['Id'] ?? (rec as Record<string, unknown>)['id'];
        const tb = typeof idRaw === 'string' || typeof idRaw === 'number' ? String(idRaw) : '';
        return val > lastCursor || (val === lastCursor && tb > lastTieBreaker);
    }

    private static async checkpointState(
        records: unknown[],
        cursorField: string,
        cursorKey: string,
        lastCursor: string | number,
        store: any,
        objectName: string,
        schema: any
    ): Promise<void> {
        const fieldDef = schema.fields.find((f: any) => f.name === cursorField);
        const fieldType = fieldDef?.type || 'string';

        // MAX across all records — safe against out-of-order results and timestamp ties
        let maxCursor: string | number | undefined;
        let maxTieBreaker: string | undefined;

        for (const rec of records) {
            const val = this.toTypedCursor((rec as Record<string, unknown>)[cursorField], fieldType);
            const idRaw = (rec as Record<string, unknown>)['Id'] ?? (rec as Record<string, unknown>)['id'];
            const tieBreaker = typeof idRaw === 'string' || typeof idRaw === 'number' ? String(idRaw) : '';

            if (maxCursor === undefined || val > maxCursor || (val === maxCursor && tieBreaker > (maxTieBreaker ?? ''))) {
                maxCursor = val;
                maxTieBreaker = tieBreaker;
            }
        }

        if (maxCursor === undefined) {
            log.debug('No new records, cursor retained', { objectName, cursor: String(lastCursor) });
        } else {
            const compositeCursor = maxTieBreaker ? `${maxCursor}||${maxTieBreaker}` : String(maxCursor);
            await store.put(cursorKey, compositeCursor);
            log.info('Cursor advanced', { objectName, cursor: String(maxCursor), tieBreaker: maxTieBreaker });
        }
    }
}

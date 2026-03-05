import { SmartCursorSelector } from './smart-cursor-selector.js';
import { IgtLogger } from './igt-logger.js';
import type { UniversalEngineConfig } from './interfaces.js';

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
            bulkAdapter,
            executeStandardQuery,
            executeCountQuery
        } = config;

        // 1. Determine Identity & Configuration
        const bulkThreshold = hint?.bulkThreshold ?? 5_000;

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
        const lastCursor = await config.store.get<string>(cursorKey)
            ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        log.debug('Polling engine active', { object: objectName, cursor: lastCursor });

        let records: unknown[] = [];

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

        // 7. Route to Bulk API if threshold exceeded
        if (bulkAdapter && totalSize >= bulkThreshold) {
            log.info('Threshold exceeded, routing to Bulk API tier', { totalSize: String(totalSize) });
            const bulkQueryString = queryAdapter.buildQuery(schema, {
                objectName,
                cursorField,
                cursorValue: lastCursor,
                autoJoins: hint?.autoJoin,
                omitLimit: true,
            });
            records = await bulkAdapter.runBulkJob(config.auth, bulkQueryString, config.store);
        } else if (totalSize === 0) {
            records = []; // Avoid round-trip if preflight says 0 rows
        } else {
            // 8. Execute Standard HTTP Polling Loop
            const queryString = queryAdapter.buildQuery(schema, {
                objectName,
                cursorField,
                cursorValue: lastCursor,
                autoJoins: hint?.autoJoin,
                limit: 2_000,
            });
            records = await executeStandardQuery(config.auth, queryString);
        }

        // 9. Checkpoint State
        // MAX across all records — safe against out-of-order results and timestamp ties
        let maxCursor: string | undefined;
        for (const rec of records) {
            const val = (rec as Record<string, unknown>)[cursorField];
            if (typeof val === 'string' && (!maxCursor || val > maxCursor)) {
                maxCursor = val;
            }
        }
        if (maxCursor) {
            await config.store.put(cursorKey, maxCursor);
            log.info('Cursor advanced', { objectName, cursor: maxCursor });
        } else {
            log.debug('No new records, cursor retained', { objectName, cursor: lastCursor });
        }

        return records;
    }
}

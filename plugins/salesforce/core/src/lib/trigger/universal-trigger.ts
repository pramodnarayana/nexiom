/* v8 ignore start */
import { createTrigger, TriggerStrategy, type TriggerContext, type TriggerStore } from '@soopa/piece-framework';
import { salesforceAuth } from '../auth.js';

import {
    UniversalTrigger,
    optimizationService,
    IgtLogger,
} from '@soopa/piece-framework/discovery';
import { SalesforceFetchError, NativeFetchAdapter } from '../../adapters/native-fetch.adapter.js';
import { checkSalesforceLimits } from '../../adapters/salesforce-limits.js';
import { salesforcesCommon, SF_API_VERSION } from '../common/index.js';
import { assertSafeSalesforceObject } from './salesforce-polling.helper.js';

import {
    SalesforceDiscoveryAdapter,
    SalesforceQueryAdapter,
    SalesforceBulkAdapter
} from '../discovery/index.js';

// Fallback to legacy triggers for shadow mode
// (Currently we only support this for polling triggers, not webhooks)

interface SfQueryPage {
    done: boolean;
    nextRecordsUrl?: string;
    records: unknown[];
    totalSize?: number;
}

interface LegacyTrigger {
    run?: (ctx: TriggerContext) => Promise<unknown>;
}

// Map of supported shadow mode objects to their POLLING legacy triggers
// If the object isn't listed here, we will not replace the payload results.
const LEGACY_TRIGGERS: Record<string, LegacyTrigger> = {
    // Only map objects that have existing polling triggers natively
    // e.g 'Contact': legacyContactPollingTrigger (if it existed)
    // For now, these were webhooks so we don't map them if there is no polling equiv:
    // 'Contact': newContact, // WEBHOOK - Removed
    // 'Lead': newLead,       // WEBHOOK - Removed
};

// Module-level singletons — in-memory schema cache survives across poll runs
const discoveryAdapter = new SalesforceDiscoveryAdapter();
const queryAdapter = new SalesforceQueryAdapter();
const bulkAdapter = new SalesforceBulkAdapter();
const nativeFetch = new NativeFetchAdapter();

export const salesforceUniversalTrigger = createTrigger({
    name: 'universal_trigger',
    displayName: 'New or Updated Record (Any Object)',
    description: 'Fires when any record is created or updated in the selected Salesforce object.',
    type: TriggerStrategy.POLLING,
    auth: salesforceAuth,
    props: {
        object: salesforcesCommon.object,
    },
    async run(context: TriggerContext) {
        const { propsValue, store } = context;
        const objectName = propsValue.object as string;
        const log = new IgtLogger({ app: 'salesforce', object: objectName });

        try {
            return await runUniversalTrigger(context, objectName, store, log);
        } catch (e: unknown) {
            if (e instanceof SalesforceFetchError && (e.status === 401 || e.status === 403)) {
                throw new Error(
                    `Your Salesforce connection has expired or been revoked. ` +
                    `Please reconnect your account in the connection settings. ` +
                    `Details: ${e.message}`,
                );
            }
            throw e;
        }
    },
    async onEnable() {
        return;
    },
    async onDisable() {
        return;
    },
});

async function runUniversalTrigger(
    context: TriggerContext,
    objectName: string,
    store: TriggerStore,
    log: IgtLogger,
): Promise<unknown[]> {
    // --- SHADOW MODE INFRASTRUCTURE ---
    /* v8 ignore start */
    const isShadowMode = process.env.IGT_SHADOW_MODE === 'true';
    let legacyRecords: unknown[] | null = null;

    if (isShadowMode && LEGACY_TRIGGERS[objectName]) {
        try {
            // Run legacy trigger path, which expects POLLING context now
            const res = await LEGACY_TRIGGERS[objectName].run!(context);
            if (Array.isArray(res)) {
                legacyRecords = res.map((r: unknown) => typeof r === 'object' && r !== null ? r : { Id: String(r || '') })
                    .filter((r: unknown) => Boolean((r as {Id?: string}).Id));
            } else {
                legacyRecords = [];
            }
        } catch (e) {
            log.warn('Shadow mode legacy trigger failed', { object: objectName, error: String(e) });
            legacyRecords = []; // Ensure valid type on fail
        }
    }
    /* v8 ignore stop */

    // --- UNIVERSAL ENGINE PATH ---
    assertSafeSalesforceObject(objectName);
    const hint = await optimizationService.getHint('salesforce', objectName);

    const authData = context.auth?.data ?? context.auth ?? {};
    const access_token = authData.access_token ?? (context.auth)?.access_token;
    const instance_url = authData.instance_url ?? context.auth?.instance_url;

    if (!access_token || !instance_url) {
        throw new SalesforceFetchError('Missing access_token or instance_url in authentication data', 401);
    }

    const flatAuth = {
        access_token: access_token as string,
        instance_url: instance_url as string
    };

    // CDC path not yet implemented — warn and fall through to REST polling
    if (hint?.preferPath === 'CDC') {
        log.warn('CDC path not yet implemented; falling back to REST polling');
        // fall through to REST path
    }

    const executeStandardQuery = async (auth: typeof flatAuth, query: string): Promise<unknown[]> => {
        /* v8 ignore start */
        const headers = { Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json' };
        const all: unknown[] = [];
        let url: string | undefined = `${auth.instance_url}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(query)}`;

        while (url) {
            const data: SfQueryPage = (await nativeFetch.get<SfQueryPage>(url as string, headers)).data;
            all.push(...(data.records ?? []));
            url = data.done || !data.nextRecordsUrl
                ? undefined
                : `${auth.instance_url}${data.nextRecordsUrl}`;
        }

        return all;
        /* v8 ignore stop */
    };

    const executeCountQuery = async (auth: typeof flatAuth, query: string): Promise<number> => {
        /* v8 ignore start */
        const url = `${auth.instance_url}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(query)}`;
        const { data } = await nativeFetch.get<SfQueryPage & { records?: Array<{ expr0?: number }> }>(url, { Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json' });
        return data.totalSize ?? data.records?.[0]?.expr0 ?? 0;
        /* v8 ignore stop */
    };

    log.info('Poll started', { object: objectName });

    // The engine advances the cursor internally before returning,
    // so shadow mode automatically gets cursor advancement — no extra code needed.
    const records = await UniversalTrigger.execute({
        auth: flatAuth,
        store,
        objectName,
        hint,
        discoveryAdapter,
        queryAdapter,
        bulkAdapter,
        executeStandardQuery,
        executeCountQuery,
        checkApiLimits: checkSalesforceLimits,
    });

    log.info('Poll completed', { object: objectName, records: String(records.length) });

    // --- SHADOW MODE COMPARISON ---
    if (isShadowMode && legacyRecords !== null) {
        validateShadowParity(legacyRecords, records, log);
        // In shadow mode, we ALWAYS return the legacy records IF they existed to prevent data impact!
        return legacyRecords;
    }

    return records;
}

function validateShadowParity(legacyRecords: unknown[], records: unknown[], log: IgtLogger): void {
    const legacyIds = new Set(legacyRecords.map(r => r && typeof r === 'object' ? (r as {Id?: string}).Id : undefined).filter(Boolean));
    const universalIds = new Set(records.map(r => r && typeof r === 'object' ? (r as {Id?: string}).Id : undefined).filter(Boolean));

    let missing = 0;
    let extra = 0;
    for (const id of legacyIds) { if (!universalIds.has(id)) missing++; }
    for (const id of universalIds) { if (!legacyIds.has(id)) extra++; }

    if (missing > 0 || extra > 0 || legacyRecords.length !== records.length) {
        log.warn('Shadow mode parity mismatch', {
            legacyCount: String(legacyRecords.length),
            universalCount: String(records.length),
            missingInUniversal: String(missing),
            extraInUniversal: String(extra),
        });
    } else {
        log.debug('Shadow mode parity OK', { count: String(legacyRecords.length) });
    }
}

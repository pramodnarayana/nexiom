import { createTrigger, TriggerStrategy, type TriggerContext, type TriggerStore } from '@nexiom/connections/framework';
import { salesforcesCommon } from '../common/index.js';
import { salesforceAuth } from '../../index.js';


import {
    optimizationService,
    discoveryService,
    SmartCursorSelector,
    DynamicQueryBuilder,
    bulkJobManager,
    type ObjectSchema,
    type ObjectHint
} from '@nexiom/connections/intelligence';

// Fallback to legacy triggers for shadow mode
import { newContact } from './new-contact.js';
import { newLead } from './new-lead.js';

function assertSafeSalesforceObject(objectName: string) {
    if (!/^\w+$/.test(objectName)) {
        throw new Error(`Invalid Salesforce object name: ${objectName}`);
    }
}

// (Map of supported shadow mode objects)
const LEGACY_TRIGGERS: Record<string, any> = {
    'Contact': newContact,
    'Lead': newLead
};

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

        // --- SHADOW MODE INFRASTRUCTURE ---
        const isShadowMode = process.env.IGT_SHADOW_MODE === 'true';
        let legacyRecords: unknown[] | null = null;

        if (isShadowMode && LEGACY_TRIGGERS[objectName]) {
            try {
                // Run legacy trigger path
                legacyRecords = await LEGACY_TRIGGERS[objectName].run!(context);
            } catch (e) {
                console.error(`[SHADOW MODE] Legacy trigger failed for ${objectName}`, e);
            }
        }

        // --- UNIVERSAL ENGINE PATH ---
        assertSafeSalesforceObject(objectName);
        const hint = await optimizationService.getHint('salesforce', objectName);

        const flatAuth = {
            access_token: context.auth.access_token as string,
            instance_url: context.auth.data.instance_url as string
        };
        const schema = await discoveryService.describe(flatAuth, objectName);

        const cursorField = SmartCursorSelector.pick(schema, hint);
        const driftOk = await discoveryService.fieldExists(flatAuth, objectName, cursorField);
        if (!driftOk) {
            console.error(`Cursor field ${cursorField} not found in ${objectName} schema`);
            return isShadowMode && legacyRecords ? legacyRecords : [];
        }

        const cursorKey = `igt_${objectName}_${cursorField}`;
        const lastCursor = await store.get<string>(cursorKey)
            ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const records = await executeUniversalQuery(
            flatAuth,
            schema,
            objectName,
            cursorField,
            lastCursor,
            hint,
            store
        );

        // --- SHADOW MODE COMPARISON ---
        if (isShadowMode && legacyRecords !== null) {
            if (legacyRecords.length !== records.length) {
                // In a real system, we'd log this to the gateway_logs table:
                console.warn(`[SHADOW MODE DIFF] ${objectName}: Legacy got ${legacyRecords.length}, Universal got ${records.length}`);
            }
            // In shadow mode, we ALWAYS return the legacy records to prevent data impact!
            return legacyRecords;
        }

        // --- PRODUCTION ADVANCE CURSOR ---
        await advanceCursor(records, cursorField, cursorKey, store);

        return records;
    },
    async onEnable() {
        return;
    },
    async onDisable() {
        return;
    },
});

async function executeUniversalQuery(
    flatAuth: { access_token: string; instance_url: string; },
    schema: ObjectSchema,
    objectName: string,
    cursorField: string,
    lastCursor: string,
    hint: ObjectHint | undefined,
    store: TriggerStore
): Promise<unknown[]> {
    const soql = DynamicQueryBuilder.buildSOQL(schema, {
        objectName,
        cursorField,
        cursorValue: lastCursor,
        autoJoins: hint?.autoJoin,
        limit: 200,
    });

    const bulkThreshold = hint?.bulkThreshold ?? 5_000;

    if (hint?.preferPath === 'CDC') {
        // CDC implementation placeholder
        return [];
    }

    const url = `${flatAuth.instance_url}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`;
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${flatAuth.access_token}` },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Salesforce Universal Trigger query failed (${response.status}): ${text}`);
    }

    const result = await response.json();

    if (result.totalSize >= bulkThreshold) {
        const bulkSoql = DynamicQueryBuilder.buildSOQL(schema, {
            objectName,
            cursorField,
            cursorValue: lastCursor,
            autoJoins: hint?.autoJoin,
            limit: 0,
        });
        return await bulkJobManager.run(flatAuth, bulkSoql.replace('LIMIT 0', '').trim(), store);
    }

    return result.records ?? [];
}

async function advanceCursor(records: unknown[], cursorField: string, cursorKey: string, store: TriggerStore): Promise<void> {
    if (records.length > 0) {
        const last = records.at(-1) as Record<string, unknown>;
        const nextCursor = last[cursorField];
        if (typeof nextCursor === 'string') {
            await store.put(cursorKey, nextCursor);
        }
    }
}

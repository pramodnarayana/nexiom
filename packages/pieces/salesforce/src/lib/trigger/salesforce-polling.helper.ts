import type { TriggerStore } from '@nexiom/connectors/framework';
import { sfFetch, SF_API_VERSION } from '../sf-fetch.js';

const SF_OBJECT_NAME_RE = /^\w{1,80}$/;

export interface SalesforceAuth {
    access_token: string;
    instance_url: string;
}

export interface PollOptions {
    cursorKey: string;
    dateField: string;
    extraColumns?: string[];
}

interface SalesforceRecord {
    [key: string]: unknown;
}

interface SalesforceQueryResponse {
    records: SalesforceRecord[];
}

export function assertSafeSalesforceObject(objectName: string): void {
    if (!SF_OBJECT_NAME_RE.test(objectName)) {
        throw new Error(`Invalid Salesforce object name`);
    }
}

const SF_FIELD_NAME_RE = /^\w+(?:__[rc])?$/;

export function assertSafeSalesforceField(fieldName: string): void {
    if (!SF_FIELD_NAME_RE.test(fieldName)) {
        throw new Error(`Invalid Salesforce field name for SOQL: ${fieldName}`);
    }
}

export async function runSalesforce(
    auth: SalesforceAuth,
    object: string,
    opts: PollOptions,
    store: TriggerStore,
): Promise<unknown[]> {
    const { cursorKey, dateField, extraColumns = [] } = opts;

    assertSafeSalesforceField(dateField);
    for (const col of extraColumns) {
        assertSafeSalesforceField(col);
    }

    const lastCursor = await store.get<string>(cursorKey);
    const since = lastCursor ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const columns = ['Id', dateField, ...extraColumns].join(', ');
    const soql = encodeURIComponent(`SELECT ${columns} FROM ${object} WHERE ${dateField} > ${since} ORDER BY ${dateField} ASC LIMIT 200`);
    const url = `${auth.instance_url}/services/data/${SF_API_VERSION}/query?q=${soql}`;

    const response = await sfFetch(url, { headers: { Authorization: `Bearer ${auth.access_token}` } });

    const body = (await response.json()) as SalesforceQueryResponse;
    const records: SalesforceRecord[] = body.records ?? [];
    if (records.length > 0) {
        const last = records.at(-1);
        if (last) {
            const sourceCursor = last[dateField];
            if (typeof sourceCursor === 'string' && sourceCursor) {
                await store.put(cursorKey, sourceCursor);
            }
        }
    }
    return records;
}

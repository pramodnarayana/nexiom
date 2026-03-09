import type { TriggerStore } from '@nexiom/connectors/framework';

const SF_OBJECT_NAME_RE = /^[A-Za-z0-9_]{1,80}$/;

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

export async function runSalesforce(
    auth: SalesforceAuth,
    object: string,
    opts: PollOptions,
    store: TriggerStore,
): Promise<unknown[]> {
    const { cursorKey, dateField, extraColumns = [] } = opts;
    const lastCursor = await store.get<string>(cursorKey);
    const since = lastCursor ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const columns = ['Id', dateField, ...extraColumns].join(', ');
    const soql = encodeURIComponent(`SELECT ${columns} FROM ${object} WHERE ${dateField} > ${since} ORDER BY ${dateField} ASC LIMIT 200`);
    const url = `${auth.instance_url}/services/data/v59.0/query?q=${soql}`;

    const response = await fetch(url, { headers: { Authorization: `Bearer ${auth.access_token}` } });
    if (!response.ok) {
        throw new Error(`Salesforce SOQL query failed`);
    }

    const body = (await response.json()) as SalesforceQueryResponse;
    const records: SalesforceRecord[] = body.records ?? [];
    if (records.length > 0) {
        const last = records[records.length - 1];
        const sourceCursor = last[dateField];
        if (typeof sourceCursor === 'string' && sourceCursor) {
            await store.put(cursorKey, sourceCursor);
        }
    }
    return records;
}

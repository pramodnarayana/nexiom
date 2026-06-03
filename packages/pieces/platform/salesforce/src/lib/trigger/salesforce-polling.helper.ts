import type { TriggerStore } from '@soopa/piece-framework';
import { sfFetch } from '../sf-fetch.js';
import { SF_API_VERSION } from '../common/index.js';

const SF_OBJECT_NAME_RE = /^\w{1,80}$/;

import type { SalesforceAuth } from '../salesforce-types.js';

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

/** Parses a compound or legacy cursor string into { sinceDate, sinceId }. */
function parseCursor(raw: string, fallbackDate: string): { sinceDate: string; sinceId: string } {
    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (typeof parsed.sinceDate === 'string' && typeof parsed.sinceId === 'string') {
            return { sinceDate: parsed.sinceDate, sinceId: parsed.sinceId };
        }
        // JSON parsed successfully but is missing required keys — reset to fallback
        // rather than reusing the raw string, which could inject untrusted JSON into SOQL.
        return { sinceDate: fallbackDate, sinceId: '' };
    } catch { /* not JSON — treat as plain ISO date string */ }
    return { sinceDate: raw || fallbackDate, sinceId: '' };
}

/** Builds the SOQL WHERE clause, adding a tie-breaker when a sinceId is available. */
function buildWhereClause(dateField: string, formattedSince: string, sinceId: string): string {
    if (!sinceId) {
        return `${dateField} > ${formattedSince}`;
    }
    return `(${dateField} > ${formattedSince}) OR (${dateField} = ${formattedSince} AND Id > '${sinceId}')`;
}

/** Persists the compound cursor from the last record in the result set. */
async function updateCursor(
    store: TriggerStore,
    cursorKey: string,
    records: SalesforceRecord[],
    dateField: string,
): Promise<void> {
    const last = records.at(-1);
    if (!last) return;
    const lastDate = last[dateField];
    const lastId = last.Id;
    if (typeof lastDate === 'string' && lastDate && typeof lastId === 'string' && lastId) {
        await store.put(cursorKey, JSON.stringify({ sinceDate: lastDate, sinceId: lastId }));
    }
}

export async function runSalesforce(
    auth: SalesforceAuth,
    object: string,
    opts: PollOptions,
    store: TriggerStore,
): Promise<unknown[]> {
    assertSafeSalesforceObject(object);
    const { cursorKey, dateField, extraColumns = [] } = opts;

    assertSafeSalesforceField(dateField);
    for (const col of extraColumns) {
        assertSafeSalesforceField(col);
    }

    const defaultDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const lastCursorStr = await store.get<string>(cursorKey);
    const { sinceDate, sinceId } = lastCursorStr
        ? parseCursor(lastCursorStr, defaultDate)
        : { sinceDate: defaultDate, sinceId: '' };

    const whereClause = buildWhereClause(dateField, sinceDate, sinceId);

    const columns = ['Id', dateField, ...extraColumns].join(', ');
    const soql = encodeURIComponent(
        `SELECT ${columns} FROM ${object} WHERE ${whereClause} ORDER BY ${dateField} ASC, Id ASC LIMIT 200`,
    );
    const url = `${auth.instance_url}/services/data/${SF_API_VERSION}/query?q=${soql}`;

    const response = await sfFetch(url, { headers: { Authorization: `Bearer ${auth.access_token}` } });
    const body = (await response.json()) as SalesforceQueryResponse;
    const records: SalesforceRecord[] = body.records ?? [];

    if (records.length > 0) {
        await updateCursor(store, cursorKey, records, dateField);
    }
    return records;
}

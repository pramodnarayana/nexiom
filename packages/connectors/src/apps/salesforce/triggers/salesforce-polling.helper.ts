/**
 * Shared polling helper for Salesforce triggers.
 *
 * Centralises: SOQL injection validation, cursor retrieval, fetch,
 * error handling, JSON parsing, and record-derived cursor update.
 *
 * All concrete field differences (cursor key, date field, SOQL columns +
 * WHERE clause) are passed as parameters so the helper stays generic.
 */
import type { TriggerStore } from '../../../framework/index.js';

/** Matches valid Salesforce API names: letters, digits, underscores, up to 80 chars. */
const SF_OBJECT_NAME_RE = /^[A-Za-z0-9_]{1,80}$/;

export interface SalesforceAuth {
    access_token: string;
    instance_url: string;
}

export interface PollOptions {
    /** Redis cursor key, e.g. 'last_created_cursor' */
    cursorKey: string;
    /** Date field used in WHERE and ORDER clauses, e.g. 'CreatedDate' */
    dateField: string;
    /** Additional SELECT columns beyond Id and the dateField */
    extraColumns?: string[];
}

interface SalesforceRecord {
    [key: string]: unknown;
}

interface SalesforceQueryResponse {
    records: SalesforceRecord[];
}

/**
 * Validates that `objectName` is a safe Salesforce API name.
 * Throws if the name contains characters that could enable SOQL injection.
 */
export function assertSafeSalesforceObject(objectName: string): void {
    if (!SF_OBJECT_NAME_RE.test(objectName)) {
        throw new Error(
            `Invalid Salesforce object name: "${objectName}". ` +
            `Only alphanumeric characters and underscores are permitted (max 80 chars).`,
        );
    }
}

/**
 * Runs a Salesforce polling query and returns new records.
 *
 * @param auth     Salesforce OAuth credentials
 * @param object   Salesforce API object name (already validated)
 * @param opts     Cursor key, date field, and optional extra SELECT columns
 * @param store    TriggerStore for reading/writing the cursor
 */
export async function runSalesforce(
    auth: SalesforceAuth,
    object: string,
    opts: PollOptions,
    store: TriggerStore,
): Promise<unknown[]> {
    const { cursorKey, dateField, extraColumns = [] } = opts;

    // ── 1. Read cursor (default to 24 h ago on first run) ──────────────────
    const lastCursor = await store.get<string>(cursorKey);
    const since = lastCursor ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // ── 2. Build bounded SOQL ───────────────────────────────────────────────
    const columns = ['Id', dateField, ...extraColumns].join(', ');
    const soql = encodeURIComponent(
        `SELECT ${columns} FROM ${object} WHERE ${dateField} > ${since} ORDER BY ${dateField} ASC LIMIT 200`,
    );
    const url = `${auth.instance_url}/services/data/v59.0/query?q=${soql}`;

    // ── 3. Fetch ────────────────────────────────────────────────────────────
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${auth.access_token}` },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Salesforce SOQL query failed (${response.status}): ${text}`);
    }

    const body = (await response.json()) as SalesforceQueryResponse;
    const records: SalesforceRecord[] = body.records ?? [];

    // ── 4. Advance cursor to last record's source timestamp ─────────────────
    // Using the record's own date field avoids server clock-skew versus the
    // Salesforce API and ensures we never skip or re-ingest records.
    if (records.length > 0) {
        const last = records[records.length - 1];
        const sourceCursor = last[dateField];
        if (typeof sourceCursor === 'string' && sourceCursor) {
            await store.put(cursorKey, sourceCursor);
        }
    }

    return records;
}

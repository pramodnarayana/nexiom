import type { TriggerStore } from '@nexiom/connections/framework';
import { quickbooksCommon, type QuickbooksEntityResponse } from '../lib/common.js';
import { type ObjectHint } from '@nexiom/connections/intelligence';
import { QuickBooksQueryAdapter } from './quickbooks-query.adapter.js';

export interface QuickBooksAuth {
    access_token: string;
    props: {
        companyId: string;
    };
}

export async function runQuickBooksQuery(
    auth: QuickBooksAuth,
    entityType: string,
    store: TriggerStore,
    hint?: ObjectHint
): Promise<unknown[]> {
    const cursorKey = `igt_${entityType}_MetaData.LastUpdatedTime`;
    const lastCursor = await store.get<string>(cursorKey);
    const since = lastCursor ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const sql = QuickBooksQueryAdapter.buildQBOQuery(entityType, {
        objectName: entityType,
        cursorField: 'MetaData.LastUpdatedTime',
        cursorValue: since,
        limit: hint?.bulkThreshold ?? 100, // example using hint
    });

    const url = `${quickbooksCommon.getApiUrl(auth.props.companyId)}/query`
        + `?query=${encodeURIComponent(sql)}&minorversion=65`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 seconds timeout

    let response: Response;
    try {
        response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${auth.access_token}`,
                Accept: 'application/json',
            },
            signal: controller.signal,
        });
    } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
            throw new Error(`QuickBooks query timed out after 15 seconds`);
        }
        throw e;
    } finally {
        clearTimeout(timeoutId);
    }

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`QuickBooks query failed (${response.status}): ${text}`);
    }

    const body = await response.json() as QuickbooksEntityResponse<unknown>;

    if (body.Fault) {
        throw new Error(`QuickBooks query fault: ${JSON.stringify(body.Fault)}`);
    }

    const records = Object.values(body.QueryResponse ?? {})
        .filter(v => Array.isArray(v)) // ignore startPosition, maxResults, totalCount
        .flat()
        .filter(v => typeof v === 'object' && v !== null);

    if (records.length > 0) {
        let maxTimestamp = 0;
        let latestCursorStr: string | null = null;
        for (const record of records as Record<string, any>[]) {
            const timeStr = record?.['MetaData']?.['LastUpdatedTime'];
            if (timeStr) {
                const parsed = Date.parse(timeStr);
                if (!Number.isNaN(parsed) && parsed > maxTimestamp) {
                    maxTimestamp = parsed;
                    latestCursorStr = timeStr;
                }
            }
        }
        if (latestCursorStr) {
            await store.put(cursorKey, latestCursorStr);
        }
    }

    return records;
}

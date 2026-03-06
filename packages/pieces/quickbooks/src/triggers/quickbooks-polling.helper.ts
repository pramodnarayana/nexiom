import type { TriggerStore } from '@nexiom/connections/framework';
import { quickbooksCommon, type QuickbooksEntityResponse } from '../lib/common.js';
import { type ObjectHint } from '@nexiom/connections/intelligence';
import { QuickBooksQueryAdapter } from './quickbooks-query.adapter.js';

export interface QuickBooksAuth {
    access_token: string;
    props: {
        companyId: string;
        useSandbox?: boolean;
    };
}

export interface Cursor {
    lastUpdatedTime?: string;
    lastId?: string;
}

export async function runQuickBooksQuery(
    auth: QuickBooksAuth,
    entityType: string,
    store: TriggerStore,
    hint?: ObjectHint
): Promise<unknown[]> {
    if (!auth || typeof auth.access_token !== 'string' || auth.access_token.trim() === '') {
        throw new Error('QuickBooks authentication missing or invalid access_token');
    }
    if (!auth.props?.companyId || typeof auth.props.companyId !== 'string' || auth.props.companyId.trim() === '') {
        throw new Error('QuickBooks authentication missing or invalid companyId');
    }

    const cursorKey = `igt_${entityType}_MetaData.LastUpdatedTime`;
    const lastCursorParams = await store.get<Cursor | string>(cursorKey);
    const { since, lastId } = parseCursorState(lastCursorParams);

    const sql = QuickBooksQueryAdapter.buildQBOQuery(entityType, {
        objectName: entityType,
        cursorField: 'MetaData.LastUpdatedTime',
        cursorValue: since,
        cursorIdField: 'Id',
        cursorIdValue: lastId,
        limit: hint?.bulkThreshold ?? 100, // example using hint
    });

    const body = await executeQuickBooksFetch(auth, sql);

    const records = Object.values(body.QueryResponse ?? {})
        .filter(v => Array.isArray(v)) // ignore startPosition, maxResults, totalCount
        .flat()
        .filter(v => typeof v === 'object' && v !== null);

    if (records.length > 0) {
        const lastRecord = records.at(-1) as Record<string, any>;
        const timeStr = lastRecord?.['MetaData']?.['LastUpdatedTime'];
        const idStr = lastRecord?.['Id']?.toString();

        if (timeStr && idStr) {
            await store.put(cursorKey, { lastUpdatedTime: timeStr, lastId: idStr });
        }
    }

    return records;
}

function parseCursorState(lastCursorParams: Cursor | string | null): { since: string; lastId: string } {
    let since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let lastId = '0';

    if (lastCursorParams && typeof lastCursorParams === 'object') {
        const parsedTime = (lastCursorParams).lastUpdatedTime;
        const parsedId = (lastCursorParams).lastId;

        if (typeof parsedTime === 'string') {
            since = parsedTime;
        }
        if (typeof parsedId === 'string' || typeof parsedId === 'number') {
            lastId = String(parsedId);
        }
    } else if (typeof lastCursorParams === 'string') {
        since = lastCursorParams;
    }

    return { since, lastId };
}

async function executeQuickBooksFetch(auth: QuickBooksAuth, sql: string): Promise<QuickbooksEntityResponse<unknown>> {
    const url = `${quickbooksCommon.getApiUrl(auth.props.companyId, auth.props.useSandbox === true)}/query`
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
        throw new Error(`QuickBooks query failed with status ${response.status} (response body omitted)`);
    }

    const body = await response.json() as QuickbooksEntityResponse<unknown>;

    if (body.Fault) {
        throw new Error(`QuickBooks query returned a fault response (fault details omitted)`);
    }

    return body;
}

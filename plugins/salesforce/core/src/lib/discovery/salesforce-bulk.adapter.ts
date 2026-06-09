import type { TriggerStore } from '@soopa/piece-framework';
import {
    type IBulkAdapter,
} from '@soopa/piece-framework/discovery';
/* v8 ignore start */
import { IgtLogger } from '@soopa/piece-framework/discovery';
import { NativeFetchAdapter, SalesforceFetchError } from '../../adapters/native-fetch.adapter.js';
import { SF_API_VERSION } from '../common/index.js';
import type { SalesforceAuth } from '../salesforce-types.js';

const log = new IgtLogger({ app: 'salesforce' });

export type BulkJobState =
    | 'IDLE'
    | 'IN_PROGRESS'
    | 'AWAITING_RESULTS'
    | 'FAILED';

export interface BulkJobCheckpoint {
    jobId: string;
    state: BulkJobState;
    soql: string;
    startedAt: string;  // ISO
}

export class SalesforceBulkAdapter implements IBulkAdapter<SalesforceAuth> {
    async runBulkJob(
        auth: SalesforceAuth,
        soql: string,
        store: TriggerStore,
    ): Promise<unknown[]> {
        const storeKey = 'igt_bulk_job_checkpoint';
        const checkpoint = await store.get<BulkJobCheckpoint>(storeKey);

        if (!checkpoint || checkpoint.state === 'IDLE' || checkpoint.state === 'FAILED' || checkpoint.soql !== soql) {
            return this.createBulkJob(auth, soql, store, storeKey);
        }

        if (checkpoint.state === 'IN_PROGRESS' || checkpoint.state === 'AWAITING_RESULTS') {
            return this.checkJobStatusAndDownload(auth, store, storeKey, checkpoint);
        }

        log.warn('Unexpected bulk job checkpoint state — resetting checkpoint for next poll cycle', {
            state: checkpoint.state,
            jobId: checkpoint.jobId,
            storeKey,
        });
        try {
            await store.delete(storeKey);
        } catch (error_) {
            log.error('Failed to reset unexpected bulk job checkpoint', {
                storeKey,
                jobId: checkpoint.jobId,
                error: String(error_),
            });
        }
        return [];
    }

    private async createBulkJob(
        auth: SalesforceAuth,
        soql: string,
        store: TriggerStore,
        storeKey: string
    ): Promise<unknown[]> {
        const url = `${auth.instance_url}/services/data/${SF_API_VERSION}/jobs/query`;
        let data: { id: string };
        try {
            const http = new NativeFetchAdapter();
            const res = await http.post<{ id: string }>(url, {
                Authorization: `Bearer ${auth.access_token}`,
                'Content-Type': 'application/json',
                Accept: 'application/json'
            }, { operation: 'query', query: soql });
            data = res.data;
        } catch (e: unknown) {
            // Check for 404 or 410 which indicate the job was deleted/expired
            if (e instanceof SalesforceFetchError && (e.status === 404 || e.status === 410)) {
                await store.delete(storeKey);
                throw new Error('Salesforce bulk query job expired or not found. State reset.');
            }
            throw new Error(`Salesforce bulk query job creation failed: ${String(e)}`);
        }

        const checkpoint: BulkJobCheckpoint = {
            jobId: data.id,
            state: 'IN_PROGRESS',
            soql,
            startedAt: new Date().toISOString()
        };
        await this.checkpoint(store, storeKey, checkpoint);
        log.info('Bulk job created', { jobId: checkpoint.jobId });
        return [];
    }

    private async checkJobStatusAndDownload(
        auth: SalesforceAuth,
        store: TriggerStore,
        storeKey: string,
        checkpoint: BulkJobCheckpoint
    ): Promise<unknown[]> {
        const url = `${auth.instance_url}/services/data/${SF_API_VERSION}/jobs/query/${checkpoint.jobId}`;
        let jobInfo: Record<string, unknown>;
        try {
            const http = new NativeFetchAdapter();
            const { data } = await http.get<Record<string, unknown>>(url, {
                Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json'
            });
            jobInfo = data;
        } catch (e: unknown) {
            if (e instanceof SalesforceFetchError && (e.status === 404 || e.status === 410)) {
                await store.delete(storeKey);
            }
            // Transient network error, do NOT delete checkpoint, except for 404/410 explicitly terminal above
            log.debug('Failed to fetch bulk job status', { error: String(e) });
            throw e;
        }

        if (jobInfo.state === 'JobComplete') {
            checkpoint.state = 'AWAITING_RESULTS';
            await this.checkpoint(store, storeKey, checkpoint);
            log.info('Bulk job complete — downloading results', { jobId: checkpoint.jobId });

            const records = await this.downloadResults(auth, checkpoint.jobId, store, storeKey);
            await store.delete(storeKey);
            log.info('Bulk job results downloaded', { jobId: checkpoint.jobId, records: String(records.length) });
            return records;
        }

        if (jobInfo.state === 'Failed' || jobInfo.state === 'Aborted') {
            await store.delete(storeKey);
            log.error('Bulk job failed or aborted', { jobId: checkpoint.jobId, state: jobInfo.state, errorMessage: jobInfo.errorMessage });
            throw new Error(`Bulk job ${jobInfo.state.toLowerCase()}: ${String(jobInfo.errorMessage)}`);
        }

        log.debug('Bulk job still in progress', { jobId: checkpoint.jobId, state: jobInfo.state });
        return [];
    }

    private async checkpoint(store: TriggerStore, storeKey: string, data: BulkJobCheckpoint): Promise<void> {
        await store.put(storeKey, data);
    }

    private async downloadResults(auth: SalesforceAuth, jobId: string, store: TriggerStore, storeKey: string): Promise<unknown[]> {
        let locator: string | null = null;
        let allRecords: unknown[] = [];

        do {
            let url = `${auth.instance_url}/services/data/${SF_API_VERSION}/jobs/query/${jobId}/results`;
            if (locator && locator !== 'null') {
                url += `?locator=${locator}`;
            }

            let text: string;
            let responseHeaders: Record<string, string>;
            try {
                const http = new NativeFetchAdapter();
                const res = await http.get<string>(url, {
                    Authorization: `Bearer ${auth.access_token}`, Accept: 'text/csv'
                });
                text = res.data;
                responseHeaders = res.headers;
            } catch (e: unknown) {
                if (e instanceof SalesforceFetchError && (e.status === 404 || e.status === 410)) {
                    await store.delete(storeKey);
                    throw new Error(`Salesforce bulk query job results expired or not found for jobId ${jobId}. State reset.`);
                }
                throw new Error(`Failed to download bulk job results: ${String(e)}`);
            }

            const pageRecords = this.parseCSV(text);
            allRecords = allRecords.concat(pageRecords);

            locator = responseHeaders['sforce-locator'] || responseHeaders['Sforce-Locator'] || null;
        } while (locator && locator !== 'null');

        return allRecords;
    }

    private parseCSV(text: string): unknown[] {
        if (!text.trim()) return [];

        const rows = this.extractCsvRows(text);
        if (rows.length <= 1) return [];

        return this.mapCsvRowsToObjects(rows);
    }

    private extractCsvRows(text: string): string[][] {
        const state = {
            rows: [] as string[][],
            currentRow: [] as string[],
            currentVal: '',
            inQuotes: false,
            skipNext: false
        };

        for (let j = 0; j < text.length; j++) {
            if (state.skipNext) {
                state.skipNext = false;
                continue;
            }
            this.processCsvChar(text[j], text[j + 1], state);
        }

        if (state.currentVal || state.currentRow.length > 0) {
            state.currentRow.push(state.currentVal);
            state.rows.push(state.currentRow);
        }

        return state.rows;
    }

    private processCsvChar(
        char: string,
        nextChar: string,
        state: { rows: string[][], currentRow: string[], currentVal: string, inQuotes: boolean, skipNext: boolean }
    ): void {
        if (char === '"') {
            if (state.inQuotes && nextChar === '"') {
                state.currentVal += '"';
                state.skipNext = true;
            } else {
                state.inQuotes = !state.inQuotes;
            }
            return;
        }

        if (state.inQuotes) {
            state.currentVal += char;
            return;
        }

        if (char === ',') {
            state.currentRow.push(state.currentVal);
            state.currentVal = '';
            return;
        }

        const isCRLF = char === '\r' && nextChar === '\n';
        if (char === '\n' || isCRLF) {
            state.currentRow.push(state.currentVal);
            state.rows.push(state.currentRow);
            state.currentRow = [];
            state.currentVal = '';
            if (char === '\r') state.skipNext = true;
            return;
        }

        state.currentVal += char;
    }

    private mapCsvRowsToObjects(rows: string[][]): unknown[] {
        const headers = rows[0].map(h => h.replaceAll(/(?:^"|"$)/g, '').trim());
        const records: unknown[] = [];

        for (let i = 1; i < rows.length; i++) {
            const values = rows[i];
            // Skip empty rows at the end
            if (values.length === 1 && values[0].trim() === '') continue;

            const record: Record<string, unknown> = {};
            for (let k = 0; k < headers.length; k++) {
                record[headers[k]] = values[k] || '';
            }
            records.push(record);
        }
        return records;
    }
}

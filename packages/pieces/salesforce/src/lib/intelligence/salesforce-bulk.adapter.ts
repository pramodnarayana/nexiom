import type { TriggerStore } from '@nexiom/connections/framework';
import {
    type IBulkAdapter,
    type SalesforceAuth,
    sfFetch,
    SF_API_VERSION,
    IgtLogger
} from '@nexiom/connections/intelligence';

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
        let checkpoint = await store.get<BulkJobCheckpoint>(storeKey);

        if (!checkpoint || checkpoint.state === 'IDLE') {
            return this.createBulkJob(auth, soql, store, storeKey);
        }

        if (checkpoint.state === 'IN_PROGRESS' || checkpoint.state === 'AWAITING_RESULTS') {
            return this.checkJobStatusAndDownload(auth, store, storeKey, checkpoint);
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
        const response = await sfFetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${auth.access_token}`,
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({ operation: 'query', query: soql }),
        });

        if (!response.ok) {
            let errMsg = response.statusText || 'Unknown error';
            try {
                const errBody = await response.json();
                if (Array.isArray(errBody) && errBody[0]?.message) {
                    errMsg = errBody[0].message;
                }
            } catch (e) {
                log.debug('Failed to parse error body', { error: String(e) });
            }
            throw new Error(`Salesforce bulk query job creation failed: ${errMsg}`);
        }

        const jobData = await response.json();
        const checkpoint: BulkJobCheckpoint = {
            jobId: jobData.id,
            state: 'IN_PROGRESS',
            soql,
            startedAt: new Date().toISOString()
        };
        await this.checkpoint(store, checkpoint);
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
        let response: Response;
        try {
            response = await sfFetch(url, {
                headers: { Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json' },
            });
        } catch (e) {
            // Transient network error, do NOT delete checkpoint
            log.debug('Failed to fetch bulk job status', { error: String(e) });
            throw e;
        }

        if (!response.ok) {
            const errBody = await response.text();
            // If job not found or explicit terminal error, we delete the checkpoint
            const terminalStatuses = new Set([404, 410]);
            if (terminalStatuses.has(response.status)) {
                await store.delete(storeKey);
            }
            throw new Error(`Failed to check bulk job status (${response.status} ${response.statusText}): ${errBody}`);
        }

        const jobInfo = await response.json();

        if (jobInfo.state === 'JobComplete') {
            checkpoint.state = 'AWAITING_RESULTS';
            await this.checkpoint(store, checkpoint);
            log.info('Bulk job complete — downloading results', { jobId: checkpoint.jobId });

            const records = await this.downloadResults(auth, checkpoint.jobId);
            await store.delete(storeKey);
            log.info('Bulk job results downloaded', { jobId: checkpoint.jobId, records: String(records.length) });
            return records;
        }

        if (jobInfo.state === 'Failed' || jobInfo.state === 'Aborted') {
            await store.delete(storeKey);
            log.error('Bulk job failed or aborted', { jobId: checkpoint.jobId, state: jobInfo.state, errorMessage: jobInfo.errorMessage });
            throw new Error(`Bulk job ${jobInfo.state.toLowerCase()}: ${jobInfo.errorMessage}`);
        }

        log.debug('Bulk job still in progress', { jobId: checkpoint.jobId, state: jobInfo.state });
        return [];
    }

    private async checkpoint(store: TriggerStore, data: BulkJobCheckpoint): Promise<void> {
        await store.put('igt_bulk_job_checkpoint', data);
    }

    private async downloadResults(auth: SalesforceAuth, jobId: string): Promise<unknown[]> {
        const url = `${auth.instance_url}/services/data/${SF_API_VERSION}/jobs/query/${jobId}/results`;
        const response = await sfFetch(url, {
            headers: { Authorization: `Bearer ${auth.access_token}`, Accept: 'text/csv' },
        });

        if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`Failed to download bulk job results (${response.status} ${response.statusText}): ${errBody}`);
        }

        const text = await response.text();
        return this.parseCSV(text);
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
        const headers = rows[0].map(h => h.replaceAll(/^"|"$/g, '').trim());
        const records: unknown[] = [];

        for (let i = 1; i < rows.length; i++) {
            const values = rows[i];
            // Skip empty rows at the end
            if (values.length === 1 && values[0].trim() === '') continue;

            const record: Record<string, any> = {};
            for (let k = 0; k < headers.length; k++) {
                record[headers[k]] = values[k] || '';
            }
            records.push(record);
        }
        return records;
    }
}

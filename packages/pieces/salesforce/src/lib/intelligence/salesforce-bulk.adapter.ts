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
                    // ignore
                }
                throw new Error(`Salesforce bulk query job creation failed: ${errMsg}`);
            }

            const jobData = await response.json();
            checkpoint = {
                jobId: jobData.id,
                state: 'IN_PROGRESS',
                soql,
                startedAt: new Date().toISOString()
            };
            await this.checkpoint(store, checkpoint);
            log.info('Bulk job created', { jobId: checkpoint.jobId });
            return [];
        }

        if (checkpoint.state === 'IN_PROGRESS' || checkpoint.state === 'AWAITING_RESULTS') {
            const url = `${auth.instance_url}/services/data/${SF_API_VERSION}/jobs/query/${checkpoint.jobId}`;
            let response: Response;
            try {
                response = await sfFetch(url, {
                    headers: { Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json' },
                });
            } catch (e) {
                // Transient network error, do NOT delete checkpoint
                throw e;
            }

            if (!response.ok) {
                const errBody = await response.text();
                // If job not found or terminal 4xx, we delete the checkpoint
                if (response.status === 404 || (response.status >= 400 && response.status < 500)) {
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
            } else if (jobInfo.state === 'Failed' || jobInfo.state === 'Aborted') {
                await store.delete(storeKey);
                log.error('Bulk job failed or aborted', { jobId: checkpoint.jobId, state: jobInfo.state, errorMessage: jobInfo.errorMessage });
                throw new Error(`Bulk job ${jobInfo.state.toLowerCase()}: ${jobInfo.errorMessage}`);
            } else {
                log.debug('Bulk job still in progress', { jobId: checkpoint.jobId, state: jobInfo.state });
                return [];
            }
        }

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

        const lines = text.split('\n').filter(l => l.trim() !== '');
        if (lines.length <= 1) return []; // header only or empty

        const headers = lines[0].split(',').map(h => {
            let header = h.trim();
            if (header.startsWith('"') && header.endsWith('"')) {
                header = header.slice(1, -1);
            }
            return header;
        });

        const records: unknown[] = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const values: string[] = [];
            let inQuotes = false;
            let currentVal = '';
            for (let j = 0; j < line.length; j++) {
                const char = line[j];
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    values.push(currentVal.trim());
                    currentVal = '';
                } else {
                    currentVal += char;
                }
            }
            values.push(currentVal.trim()); // push last col

            const record: Record<string, any> = {};
            for (let k = 0; k < headers.length; k++) {
                let val = values[k] || '';
                if (val.startsWith('"') && val.endsWith('"')) {
                    val = val.slice(1, -1).replace(/""/g, '"');
                }
                record[headers[k]] = val;
            }
            records.push(record);
        }
        return records;
    }
}

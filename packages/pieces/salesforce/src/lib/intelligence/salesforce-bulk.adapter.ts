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
                await store.delete(storeKey);
                throw e;
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
            headers: { Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json' },
        });

        const text = await response.text();
        return this.parseNdjson(text);
    }

    private parseNdjson(text: string): unknown[] {
        if (!text.trim()) return [];

        const records: unknown[] = [];
        for (const line of text.split('\n')) {
            if (!line.trim()) continue;
            try {
                records.push(JSON.parse(line));
            } catch (e) {
                log.debug('Skipping unparseable NDJSON line', { error: String(e) });
            }
        }
        return records;
    }
}

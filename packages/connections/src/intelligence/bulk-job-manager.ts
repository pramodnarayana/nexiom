import type { TriggerStore } from '../framework/index.js';
import type { SalesforceAuth } from '../apps/salesforce/triggers/salesforce-polling.helper.js';

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

export class BulkJobManager {
    /**
     * Checks TriggerStore for an in-progress Bulk job checkpoint.
     * If one exists, polls its status.
     * If complete, downloads results and returns records[].
     * If none exists, creates a new Bulk job for the given SOQL.
     */
    async run(
        auth: SalesforceAuth,
        soql: string,
        store: TriggerStore,
    ): Promise<unknown[]> {
        const storeKey = 'igt_bulk_job_checkpoint';
        let checkpoint = await store.get<BulkJobCheckpoint>(storeKey);

        if (!checkpoint || checkpoint.state === 'IDLE') {
            // Create new Bulk Query Job
            const url = `${auth.instance_url}/services/data/v59.0/jobs/query`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${auth.access_token}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                body: JSON.stringify({
                    operation: 'query',
                    query: soql
                })
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`Failed to create bulk query job: ${err}`);
            }

            const jobData = await response.json();
            checkpoint = {
                jobId: jobData.id,
                state: 'IN_PROGRESS',
                soql,
                startedAt: new Date().toISOString()
            };
            await this.checkpoint(store, checkpoint);
            return []; // Return empty this poll cycle
        }

        if (checkpoint.state === 'IN_PROGRESS' || checkpoint.state === 'AWAITING_RESULTS') {
            // Poll status
            const url = `${auth.instance_url}/services/data/v59.0/jobs/query/${checkpoint.jobId}`;
            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${auth.access_token}`,
                    Accept: 'application/json'
                }
            });

            if (!response.ok) {
                await store.delete(storeKey);
                throw new Error(`Failed to poll bulk query job status: ${response.statusText}`);
            }

            const jobInfo = await response.json();

            if (jobInfo.state === 'JobComplete') {
                checkpoint.state = 'AWAITING_RESULTS';
                await this.checkpoint(store, checkpoint);

                const records = await this.downloadResults(auth, checkpoint.jobId);
                await store.delete(storeKey);
                return records;
            } else if (jobInfo.state === 'Failed' || jobInfo.state === 'Aborted') {
                await store.delete(storeKey);
                throw new Error(`Bulk job failed or aborted: ${jobInfo.errorMessage}`);
            } else {
                // Still in progress
                return [];
            }
        }

        return [];
    }

    /** Stores IN_PROGRESS checkpoint so duplicate pollers skip this run. */
    private async checkpoint(store: TriggerStore, data: BulkJobCheckpoint): Promise<void> {
        await store.put('igt_bulk_job_checkpoint', data);
    }

    /** Downloads Bulk API result CSV/NDJSON, streams into records[]. */
    private async downloadResults(auth: SalesforceAuth, jobId: string): Promise<unknown[]> {
        const url = `${auth.instance_url}/services/data/v59.0/jobs/query/${jobId}/results`;
        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${auth.access_token}`,
                Accept: 'application/json' // request JSON format if supported, or handle CSV/NDJSON
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to download results: ${response.statusText}`);
        }

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
                // ignore bad line or Header line in CSV
                console.debug('Failed to parse NDJSON line:', e);
            }
        }
        return records;
    }
}

export const bulkJobManager = new BulkJobManager();

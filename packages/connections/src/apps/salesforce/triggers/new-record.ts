import {
    createTrigger,
    TriggerStrategy,
    type TriggerContext,
    Property,
} from '../../../framework/index.js';

interface SalesforceAuth {
    access_token: string;
    instance_url: string;
}

interface NewRecordProps {
    object: string;
    pollIntervalMinutes?: number;
}

/**
 * Polling trigger — fires for every Salesforce record created since the last cursor.
 * The cursor (ISO timestamp) is persisted in Redis via TriggerContext.store.
 */
export const newRecordTrigger = createTrigger<SalesforceAuth, NewRecordProps>({
    name: 'new_record',
    displayName: 'New Record',
    description: 'Triggers whenever a new Salesforce record is created for the selected object type.',
    type: TriggerStrategy.POLLING,
    props: {
        object: Property.ShortText({
            displayName: 'Salesforce Object',
            description: 'The API name of the Salesforce object to watch (e.g. Account, Contact, Opportunity).',
            required: true,
        }),
    },

    async run(context: TriggerContext<SalesforceAuth, NewRecordProps>): Promise<unknown[]> {
        const { auth, propsValue, store } = context;
        const { object } = propsValue;

        const lastCursor = await store.get<string>('last_created_cursor');
        // Default to 24 h ago on first run so we don't ingest the entire history
        const since = lastCursor ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const soql = encodeURIComponent(
            `SELECT Id, Name, CreatedDate FROM ${object} WHERE CreatedDate > ${since} ORDER BY CreatedDate ASC LIMIT 200`,
        );
        const url = `${auth.instance_url}/services/data/v59.0/query?q=${soql}`;

        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${auth.access_token}` },
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Salesforce SOQL query failed (${response.status}): ${text}`);
        }

        const body = await response.json() as { records: unknown[] };
        const records = body.records ?? [];

        // Advance cursor only after successful fetch; ingestion atomicity is
        // handled by TriggerExecutorService (cursor written post-insert).
        if (records.length > 0) {
            await store.put('last_created_cursor', new Date().toISOString());
        }

        return records;
    },
});

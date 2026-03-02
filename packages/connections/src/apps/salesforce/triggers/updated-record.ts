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

interface UpdatedRecordProps {
    object: string;
}

/**
 * Polling trigger — fires for every Salesforce record updated since the last cursor.
 * Uses LastModifiedDate so truly unchanged records are never re-ingested.
 */
export const updatedRecordTrigger = createTrigger<SalesforceAuth, UpdatedRecordProps>({
    name: 'updated_record',
    displayName: 'Updated Record',
    description: 'Triggers whenever an existing Salesforce record is modified for the selected object type.',
    type: TriggerStrategy.POLLING,
    props: {
        object: Property.ShortText({
            displayName: 'Salesforce Object',
            description: 'The API name of the Salesforce object to watch (e.g. Account, Contact, Opportunity).',
            required: true,
        }),
    },

    async run(context: TriggerContext<SalesforceAuth, UpdatedRecordProps>): Promise<unknown[]> {
        const { auth, propsValue, store } = context;
        const { object } = propsValue;

        const lastCursor = await store.get<string>('last_modified_cursor');
        const since = lastCursor ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const soql = encodeURIComponent(
            `SELECT Id, Name, LastModifiedDate FROM ${object} WHERE LastModifiedDate > ${since} ORDER BY LastModifiedDate ASC LIMIT 200`,
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

        if (records.length > 0) {
            await store.put('last_modified_cursor', new Date().toISOString());
        }

        return records;
    },
});

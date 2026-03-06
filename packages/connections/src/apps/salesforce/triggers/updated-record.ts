import {
    createTrigger,
    TriggerStrategy,
    type TriggerContext,
    Property,
} from '../../../framework/index.js';
import {
    assertSafeSalesforceObject,
    runSalesforce,
    type SalesforceAuth,
} from './salesforce-polling.helper.js';

interface UpdatedRecordProps {
    object: string;
}

/**
 *  trigger — fires for every Salesforce record updated since the last cursor.
 * Uses LastModifiedDate so truly unchanged records are never re-ingested.
 * The cursor is the LastModifiedDate of the last returned record, stored in Redis.
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

        // Guard against SOQL injection before any interpolation
        assertSafeSalesforceObject(object);

        return runSalesforce(auth, object, {
            cursorKey: 'last_modified_cursor',
            dateField: 'LastModifiedDate',
            extraColumns: ['Name'],
        }, store);
    },
});

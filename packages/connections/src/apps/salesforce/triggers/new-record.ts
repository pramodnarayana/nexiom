import {
    createTrigger,
    TriggerStrategy,
    type TriggerContext,
    Property,
} from '../../../framework/index.js';
import {
    assertSafeSalesforceObject,
    runSalesforcePolling,
    type SalesforceAuth,
} from './salesforce-polling.helper.js';

interface NewRecordProps {
    object: string;
}

/**
 * Polling trigger — fires for every Salesforce record created since the last cursor.
 * The cursor (ISO timestamp from the last record's CreatedDate) is persisted in
 * Redis via TriggerContext.store.
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

        // Guard against SOQL injection before any interpolation
        assertSafeSalesforceObject(object);

        return runSalesforcePolling(auth, object, {
            cursorKey: 'last_created_cursor',
            dateField: 'CreatedDate',
            extraColumns: ['Name'],
        }, store);
    },
});

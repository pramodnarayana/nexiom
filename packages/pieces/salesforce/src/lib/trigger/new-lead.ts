import {
  DedupeStrategy,
  HttpMethod,
  
  pollingHelper,
  
  TriggerStrategy,
  createTrigger
} from '@nexiom/connections/framework';
import { querySalesforceApi } from '../common';

import dayjs from 'dayjs';
import { salesforceAuth } from '../..';

export const newLead = createTrigger({
    auth: salesforceAuth,
    name: 'new_lead',
    displayName: 'New Lead',
    description: 'Fires when a new Lead record is created in Salesforce.',
    props: {},
    sampleData: {
        "Id": "00Q7Q000003x4aXUAQ",
        "Company": "ACME Inc.",
        "Name": "John Doe",
        "CreatedDate": "2025-10-10T12:00:00.000Z",
    },
    type: TriggerStrategy.WEBHOOK,
  run: async (context: any) => [context.payload?.body || context.payload],
});


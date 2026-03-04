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

export const newContact = createTrigger({
    auth: salesforceAuth,
    name: 'new_contact',
    displayName: 'New Contact',
    description: 'Fires when a new Contact record is created in Salesforce.',
    props: {},
    sampleData: {
        "Id": "0037Q000005x4aXUAQ",
        "AccountId": "0017Q00000qM8c9QAC",
        "Name": "Jane Doe",
        "CreatedDate": "2025-10-10T12:00:00.000Z",
    },
    type: TriggerStrategy.WEBHOOK,
  run: async (context: any) => [context.payload?.body || context.payload],
});


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

export const newUpdatedFile = createTrigger({
    auth: salesforceAuth,
    name: 'new_updated_file',
    displayName: 'New or Updated File',
    description: 'Fires when a file (ContentDocument) is created or updated. Does not fire for classic Attachments or Notes.',
    props: {},
    sampleData: {
        "Id": "0697Q000002qB9iQAE",
        "Title": "My Document.pdf",
        "LastModifiedDate": "2025-10-10T12:00:00.000Z",
        "Type": "ContentDocument"
    },
    type: TriggerStrategy.WEBHOOK,
  run: async (context: any) => [context.payload?.body || context.payload],
});


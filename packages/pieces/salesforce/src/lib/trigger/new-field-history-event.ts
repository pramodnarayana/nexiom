import {
  DedupeStrategy,
  HttpMethod,
  
  pollingHelper,
  
  TriggerStrategy,
  createTrigger
} from '@nexiom/connections/framework';
import { querySalesforceApi, salesforcesCommon } from '../common';

import dayjs from 'dayjs';
import { salesforceAuth } from '../..';

export const newFieldHistoryEvent = createTrigger({
    auth: salesforceAuth,
    name: 'new_field_history_event',
    displayName: 'New Field History Event',
    description: 'Fires when a tracked field is updated on a specified object.',
    props: {
        object: salesforcesCommon.object,
    },
    sampleData: {
        "Id": "0177Q00000s912jQAA",
        "IsDeleted": false,
        "ParentId": "0017Q00000qM8c9QAC",
        "CreatedById": "0057Q000003h3VwQAI",
        "CreatedDate": "2025-10-10T12:00:00.000Z",
        "Field": "Industry",
        "OldValue": "Agriculture",
        "NewValue": "Technology"
    },
    type: TriggerStrategy.WEBHOOK,
  run: async (context: any) => [context.payload?.body || context.payload],
});



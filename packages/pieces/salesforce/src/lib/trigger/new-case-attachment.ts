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

export const newCaseAttachment = createTrigger({
    auth: salesforceAuth,
    name: 'new_case_attachment',
    displayName: 'New Case Attachment',
    description: 'Fires when a new Attachment or File is added to any Case record.',
    props: {},
    sampleData: {
        "Id": "00P7Q000002XyA4UAK",
        "ParentId": "5007Q000006g75iQAA",
        "Name": "sample_attachment.txt",
        "ContentType": "text/plain",
        "CreatedDate": "2025-10-10T12:00:00.000Z",
        "attachment_type": "Classic"
    },
    type: TriggerStrategy.WEBHOOK,
  run: async (context: any) => [context.payload?.body || context.payload],
});


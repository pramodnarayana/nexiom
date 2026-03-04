import {
  TriggerStrategy,
  createTrigger,
  
  
} from '@nexiom/connections/framework';
import { quickbooksAuth } from '../index';
import dayjs from 'dayjs';
import {
  DedupeStrategy,
  httpClient,
  HttpMethod,
  
  pollingHelper,
} from '@nexiom/connections/framework';
import { quickbooksCommon, QuickbooksEntityResponse } from '../lib/common';
import { QuickbooksInvoice } from '../lib/types';


export const newTransfer = createTrigger({
  auth: quickbooksAuth,
  name: 'new_transfer',
  displayName: 'New Transfer',
  description:
    'Triggers when a Transfer is created.',
  props: {},
  type: TriggerStrategy.WEBHOOK,
  sampleData: undefined,
  run: async (context: any) => [context.payload?.body || context.payload],
});

import {
  TriggerStrategy,
  createTrigger,
  
  
} from '@nexiom/connections/framework';
import { quickbooksAuth } from '../index';
import {
  DedupeStrategy,
  httpClient,
  HttpMethod,
  
  pollingHelper,
} from '@nexiom/connections/framework';
import { quickbooksCommon, QuickbooksEntityResponse } from '../lib/common';
import dayjs from 'dayjs';
import { QuickbooksInvoice } from '../lib/types';


export const newInvoice = createTrigger({
  auth: quickbooksAuth,
  name: 'new_invoice',
  displayName: 'New Invoice',
  description: 'Triggers when an invoice is created .',
  props: {},
  type: TriggerStrategy.WEBHOOK,
  sampleData: undefined,
  run: async (context: any) => [context.payload?.body || context.payload],
});

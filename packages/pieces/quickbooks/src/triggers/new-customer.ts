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
import { QuickbooksCustomer } from '../lib/types';


export const newCustomer = createTrigger({
  auth: quickbooksAuth,
  name: 'new_customer',
  displayName: 'New Customer',
  description: 'Triggers when a new customer is created.',
  props: {},
  type: TriggerStrategy.WEBHOOK,
  sampleData: undefined,
  run: async (context: any) => [context.payload?.body || context.payload],
});

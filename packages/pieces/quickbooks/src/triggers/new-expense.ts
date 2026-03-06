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
import { QuickbooksPurchase } from '../lib/types';
import dayjs from 'dayjs';


export const newExpense = createTrigger({
  auth: quickbooksAuth,
  name: 'new_expense',
  displayName: 'New Expense (Purchase)',
  description: 'Triggers when an Expense (Purchase) is created.',
  props: {},
  type: TriggerStrategy.WEBHOOK,
  sampleData: undefined,
  run: async (context: any) => [context.payload?.body || context.payload],
});

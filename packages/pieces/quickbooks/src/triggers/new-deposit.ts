import {
  
  
  TriggerStrategy,
  createTrigger,
} from "@nexiom/connections/framework";
import { quickbooksAuth } from '../index';
import { quickbooksCommon, QuickbooksEntityResponse } from "../lib/common";
import { QuickbooksCustomer } from '../lib/types';
import dayjs from 'dayjs';


export const newDeposit = createTrigger({
  auth: quickbooksAuth,
  name: 'new_deposit',
  displayName: 'New Deposit',
  description: 'Triggers when a Deposit is created.',
  props: {},
  type: TriggerStrategy.WEBHOOK,
  sampleData: undefined,
  run: async (context: any) => [context.payload?.body || context.payload],
}); 
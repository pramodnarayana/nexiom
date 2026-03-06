import {
  DedupeStrategy,
  HttpMethod,

  pollingHelper,

  Property,
  TriggerStrategy,
  createTrigger
} from '@nexiom/connections/framework';
import { querySalesforceApi, salesforcesCommon } from '../common';

import dayjs from 'dayjs';
import { salesforceAuth } from '../..';

export const newOrUpdatedRecord = createTrigger({
  auth: salesforceAuth,
  name: 'new_or_updated_record',
  displayName: 'New or Updated Record',
  description: 'Triggers when there is new or updated record',
  props: {
    object: salesforcesCommon.object,
    conditions: Property.LongText({
      displayName: 'Conditions (Advanced)',
      description: 'Enter a SOQL query where clause i. e. IsDeleted = TRUE',
      required: false,
    }),
  },
  sampleData: {},
  type: TriggerStrategy.WEBHOOK,
  run: async (context: any) => [context.payload?.body || context.payload],
});


const getRecords = async (
  authentication: any,
  object: string,
  startDate: string,
  conditions: string | undefined
) => {
  const response = await querySalesforceApi<{
    records: { LastModifiedDate: string }[];
  }>(
    HttpMethod.GET,
    authentication,
    constructQuery(object, 200, 0, startDate, conditions)
  );
  return response.body['records'];
};

function constructQuery(
  object: string,
  limit: number,
  offset: number,
  startDate: string,
  conditions: string | undefined
) {
  return `
    SELECT
      FIELDS(ALL)
    FROM
      ${object}
    WHERE LastModifiedDate > ${startDate} ${conditions != undefined ? `AND ${conditions}` : ''
    }
    ORDER BY LastModifiedDate ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}

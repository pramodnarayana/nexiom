// Barrel for the salesforce trigger subpath entry-point.
// Consumed by `@nexiom/piece-salesforce/trigger`.
export { salesforceUniversalTrigger } from './universal-trigger.js';
export {
    runSalesforce,
    assertSafeSalesforceField,
    assertSafeSalesforceObject,
} from './salesforce-polling.helper.js';
export type { PollOptions } from './salesforce-polling.helper.js';
export type { SalesforceAuth } from '../salesforce-types.js';

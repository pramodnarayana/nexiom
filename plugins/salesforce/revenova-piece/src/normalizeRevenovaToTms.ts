import type { NormalizerFn } from '@soopa/piece-framework';
import { AccountTransformer } from './transformers/account.transformer.js';
import { TransportationProfileTransformer } from './transformers/transportation-profile.transformer.js';

// Instantiate the strict native TypeScript transformers once at module load
const accountTransformer = new AccountTransformer();
const tpTransformer = new TransportationProfileTransformer();

/**
 * normalizeRevenovaToTms — Revenova's NormalizerFn for TMS entities.
 *
 * Uses the @soopa/transformer native architecture instead of JSONata
 * for nanosecond execution speed and compile-time type safety.
 */
export const normalizeRevenovaToTms: NormalizerFn = async ({ entityType, data }) => {
    try {
        const input = { entityType, data: data as Record<string, unknown> };

        if (entityType === 'Account') {
            return accountTransformer.transform(input);
        }

        if (entityType === 'rtms__TransportationProfile__c') {
            return tpTransformer.transform(input);
        }

        return null;
    } catch (err) {
        console.error(`[normalizeRevenovaToTms] Native Transformer evaluation failed:`, err);
        return null;
    }
};
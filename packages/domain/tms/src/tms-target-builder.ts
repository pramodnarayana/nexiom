import { sql } from 'drizzle-orm';
import type { AppTargetBuilderFn } from '@nexiom/piece-framework';
import type { DrizzleDb } from '@nexiom/database';
import { buildTmsSchema } from './schema/tms-schema.js';

// ---------------------------------------------------------------------------
// TMS Target Builder Hook — @nexiom/domain-tms
//
// Shared by ALL TMS source connectors.
// Executes three SQL lookups on indexed sf_id columns:
//   tms_carrier (or tms_vendor) → tms_tp → remit-to tms_carrier | tms_factoring
//
// Returns a flat enrichment context for field mapping Rule[] src paths.
// ---------------------------------------------------------------------------

const CARRIER_TYPES = new Set(['TMS_CARRIER', 'TMS_VENDOR']);

export const tmsTargetBuilder: AppTargetBuilderFn = async (
    db,
    schemaName,
    normalizedEntityType,
    srcEntityId,
): Promise<Record<string, unknown>> => {
    if (!CARRIER_TYPES.has(normalizedEntityType)) return {};

    const dbTyped = db as DrizzleDb;
    const { tmsCarrier, tmsVendor, tmsTp, tmsFactoring } = buildTmsSchema(schemaName);

    // ── 1. Source account ─────────────────────────────────────────────────────
    const table = normalizedEntityType === 'TMS_CARRIER' ? tmsCarrier : tmsVendor;
    const accountRows = await dbTyped
        .select()
        .from(table)
        .where(sql`${table.sfId} = ${srcEntityId}`)
        .limit(1);

    if (!accountRows[0]) return {};
    const account = accountRows[0];

    // ── 2. Transportation Profile ─────────────────────────────────────────────
    let tp: Record<string, unknown> | null = null;
    let remitTo: Record<string, unknown> | null = null;

    if (account.tpSfId) {
        const tpRows = await dbTyped
            .select()
            .from(tmsTp)
            .where(sql`${tmsTp.sfId} = ${account.tpSfId}`)
            .limit(1);

        if (tpRows[0]) {
            const r = tpRows[0];
            tp = {
                mcNumber: r.mcNumber, scac: r.scac, federalTaxId: r.federalTaxId,
                usdot: r.usdot, remitToOption: r.remitToOption,
                carrierOperation: r.carrierOperation, agreementStatus: r.agreementStatus,
                carrierReviewStatus: r.carrierReviewStatus,
            };

            // ── 3. Remit-To Account ───────────────────────────────────────────
            if (r.remitToSfId) {
                const selfRemit = await dbTyped.select().from(tmsCarrier)
                    .where(sql`${tmsCarrier.sfId} = ${r.remitToSfId}`).limit(1);

                if (selfRemit[0]) {
                    const ra = selfRemit[0];
                    remitTo = { displayName: ra.displayName, street: ra.billingStreet,
                        city: ra.billingCity, state: ra.billingState,
                        postalCode: ra.billingPostalCode, country: ra.billingCountry,
                        phone: ra.phone, fax: ra.fax };
                } else {
                    const factoringRemit = await dbTyped.select().from(tmsFactoring)
                        .where(sql`${tmsFactoring.sfId} = ${r.remitToSfId}`).limit(1);
                    if (factoringRemit[0]) {
                        const ra = factoringRemit[0];
                        remitTo = { displayName: ra.displayName, street: ra.billingStreet,
                            city: ra.billingCity, state: ra.billingState,
                            postalCode: ra.billingPostalCode, country: ra.billingCountry,
                            phone: ra.phone, fax: ra.fax };
                    }
                }
            }
        }
    }

    // ── 4. Flat enrichment context for Rule[] field mapping ───────────────────
    return {
        displayName: account.displayName, tmsType: account.tmsType,
        billingStreet: account.billingStreet, billingCity: account.billingCity,
        billingState: account.billingState, billingPostalCode: account.billingPostalCode,
        billingCountry: account.billingCountry, phone: account.phone,
        fax: account.fax, email: account.email,
        tp,
        remitTo,
    };
};

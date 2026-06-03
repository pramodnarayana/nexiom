import { sql } from 'drizzle-orm';
import type { AppTargetBuilderFn, AppsConnectorDb } from '@soopa/piece-framework';
import { buildTmsSchema } from './schema/tms-schema.js';

// ---------------------------------------------------------------------------
// TMS Target Builder Hook — @soopa/domain-tms
//
// Shared by ALL TMS source connectors.
// Executes SQL lookups on indexed source_id columns:
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

    const dbTyped = db as AppsConnectorDb;
    const { tmsCarrier, tmsVendor, tmsTp, tmsFactoring } = buildTmsSchema(schemaName);

    // ── 1. Source account ─────────────────────────────────────────────────────
    const table = normalizedEntityType === 'TMS_CARRIER' ? tmsCarrier : tmsVendor;
    const accountRows = await dbTyped
        .select()
        .from(table)
        .where(sql`${table.sourceId} = ${srcEntityId}`)
        .limit(1);

    if (!accountRows[0]) return {};
    const account = accountRows[0];

    const missingDependencies: Array<{ entityType: string; sourceId: string }> = [];

    // ── 2. Transportation Profile ─────────────────────────────────────────────
    let tp: Record<string, unknown> | null = null;
    let remitTo: Record<string, unknown> | null = null;

    if (account.tpSourceId) {
        const tpRows = await dbTyped
            .select()
            .from(tmsTp)
            .where(sql`${tmsTp.sourceId} = ${account.tpSourceId}`)
            .limit(1);

        if (tpRows[0]) {
            const r = tpRows[0];
            tp = {
                invoiceTerms: r.invoiceTerms,
                paymentTerms: r.paymentTerms,
                carrierPaymentTerms: r.carrierPaymentTerms,
                companyType: r.companyType,
                creditLimit: r.creditLimit,
                remitToOption: r.remitToOption,
                mcNumber: r.mcNumber,
                stateDotNumber: r.stateDotNumber,
                usDotNumber: r.usDotNumber,
            };
            
            // To be resolved below
            (account as any)._tpRemitToSourceId = r.carrierRemitTo;
        } else {
            missingDependencies.push({ entityType: 'TMS_TP', sourceId: account.tpSourceId as string });
        }
    }

    // ── 3. Remit-To Account (COALESCE: account first, then tp) ────────────────
    const finalRemitToSourceId = (account as any).remitToSourceId || (account as any)._tpRemitToSourceId;

    if (finalRemitToSourceId) {
        const selfRemit = await dbTyped.select().from(tmsCarrier)
            .where(sql`${tmsCarrier.sourceId} = ${finalRemitToSourceId}`).limit(1);

        if (selfRemit[0]) {
            const ra = selfRemit[0];
            remitTo = { displayName: ra.displayName, street: ra.billingStreet,
                city: ra.billingCity, state: ra.billingState,
                postalCode: ra.billingPostalCode, country: ra.billingCountry,
                phone: ra.phone, fax: ra.fax };
        } else {
            const factoringRemit = await dbTyped.select().from(tmsFactoring)
                .where(sql`${tmsFactoring.sourceId} = ${finalRemitToSourceId}`).limit(1);
            if (factoringRemit[0]) {
                const ra = factoringRemit[0];
                remitTo = { displayName: ra.displayName, street: ra.billingStreet,
                    city: ra.billingCity, state: ra.billingState,
                    postalCode: ra.billingPostalCode, country: ra.billingCountry,
                    phone: ra.phone, fax: ra.fax };
            } else {
                missingDependencies.push({ entityType: 'TMS_REMIT_TO', sourceId: finalRemitToSourceId as string });
            }
        }
    }

    if (missingDependencies.length > 0) {
        const { DependenciesMissingError } = await import('@soopa/piece-framework');
        throw new DependenciesMissingError(missingDependencies);
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

import { sql } from 'drizzle-orm';
import type { AppNormalizedWriterFn } from '@nexiom/piece-framework';
import type { DrizzleDb } from '@nexiom/database';
import { buildTmsSchema } from './schema/tms-schema.js';
import { validateTmsIdentifier } from './schema/tms-identifier-validator.js';

// ---------------------------------------------------------------------------
// TMS Normalized Writer Hook — @nexiom/domain-tms
//
// Shared by ALL TMS source connectors (Revenova, McLeod, TMW…).
// Registered by each connector's index.ts:
//   registerNormalizedWriter('salesforce', 'revenova', tmsNormalizedWriter)
//
// Called by NormalizationService (step 3.5) inside the existing db transaction
// after writing to the generic normalized_entity table. Writes to the
// appropriate typed tms_* table based on normalizedEntityType.
// ---------------------------------------------------------------------------

type DrizzleTransaction = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

// Helper to convert unknown values to nullable strings
const str = (v: unknown) => {
    if (typeof v === 'string') return v;
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    return null;
};

// Common fields present in all TMS entities
function commonFields(data: Record<string, unknown>) {
    return {
        displayName: str(data['displayName']),
        tmsType: str(data['tmsType']),
        billingStreet: str(data['billingStreet']),
        billingCity: str(data['billingCity']),
        billingState: str(data['billingState']),
        billingPostalCode: str(data['billingPostalCode']),
        billingCountry: str(data['billingCountry']),
        phone: str(data['phone']),
        fax: str(data['fax']),
        email: str(data['email']),
    };
}

// Generic upsert helper for TMS entities
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsert(
    tx: DrizzleTransaction,
    table: any,
    base: { traceId: string; replicaId: string; sfId: string },
    extras: Record<string, unknown>
) {
    const values = { ...base, ...extras };
    const updateSet = { traceId: base.traceId, replicaId: base.replicaId, updatedAt: new Date(), ...extras };

    await tx
        .insert(table as never)
        .values(values as never)
        .onConflictDoUpdate({
            target: table.sfId as never,
            set: updateSet as never,
        });
}

export const tmsNormalizedWriter: AppNormalizedWriterFn = async (
    tx,
    _db,
    schemaName,
    replicaId,
    entityId,
    traceId,
    normalizedEntityType,
    data,
) => {
    // Validate schemaName against SQL injection and Postgres limits
    validateTmsIdentifier(schemaName);

    const txTyped = tx as DrizzleTransaction;

    const { tmsCarrier, tmsVendor, tmsCustomer, tmsFactoring, tmsAddress, tmsTp } =
        buildTmsSchema(schemaName);

    const base = { traceId, replicaId, sfId: entityId };

    if (normalizedEntityType === 'TMS_CARRIER') {
        await upsert(txTyped, tmsCarrier, base, {
            ...commonFields(data),
            tpSfId: str(data['tpSfId']),
            isCarrier: str(data['isCarrier']),
            isBroker: str(data['isBroker']),
        });
        return;
    }

    if (normalizedEntityType === 'TMS_VENDOR') {
        await upsert(txTyped, tmsVendor, base, {
            ...commonFields(data),
            tpSfId: str(data['tpSfId']),
            isVendor: str(data['isVendor']),
        });
        return;
    }

    if (normalizedEntityType === 'TMS_CUSTOMER') {
        await upsert(txTyped, tmsCustomer, base, {
            ...commonFields(data),
            creditLimit: str(data['creditLimit']),
            paymentTerms: str(data['paymentTerms']),
        });
        return;
    }

    if (normalizedEntityType === 'TMS_FACTORING') {
        await upsert(txTyped, tmsFactoring, base, {
            ...commonFields(data),
        });
        return;
    }

    if (normalizedEntityType === 'TMS_ADDRESS') {
        await upsert(txTyped, tmsAddress, base, {
            ...commonFields(data),
            isPickup: str(data['isPickup']),
            isDelivery: str(data['isDelivery']),
        });
        return;
    }

    if (normalizedEntityType === 'TMS_TP') {
        await upsert(txTyped, tmsTp, base, {
            mcNumber: str(data['mcNumber']),
            scac: str(data['scac']),
            federalTaxId: str(data['federalTaxId']),
            usdot: str(data['usdot']),
            remitToSfId: str(data['remitToSfId']),
            remitToOption: str(data['remitToOption']),
            carrierOperation: str(data['carrierOperation']),
            agreementStatus: str(data['agreementStatus']),
            carrierReviewStatus: str(data['carrierReviewStatus']),
        });
        return;
    }

    // Known canonical types that are not yet implemented
    if (normalizedEntityType === 'TMS_LOAD' || normalizedEntityType === 'TMS_INVOICE') {
        const warnMsg = `TMS normalized writer: type ${normalizedEntityType} is recognized but not yet implemented (traceId=${traceId})`;
        // Always throw here — let normalization.service.ts's try/catch convert to warnings
        throw new Error(warnMsg);
    }

    // Unknown type — normalized_entity already has it, skip typed write
};

import { sql } from 'drizzle-orm';
import type { AppNormalizedWriterFn } from '@nexiom/piece-framework';
import type { DrizzleDb } from '@nexiom/database';
import { buildTmsSchema } from './schema/tms-schema.js';

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
    const txTyped = tx as DrizzleTransaction;
    await txTyped.execute(sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`);

    const { tmsCarrier, tmsVendor, tmsCustomer, tmsFactoring, tmsAddress, tmsTp } =
        buildTmsSchema(schemaName);

    const base = { traceId, replicaId, sfId: entityId };

    const str = (v: unknown) => (typeof v === 'string' ? v : null);

    if (normalizedEntityType === 'TMS_CARRIER') {
        await txTyped.insert(tmsCarrier).values({
            ...base,
            displayName: str(data['displayName']), tmsType: str(data['tmsType']),
            billingStreet: str(data['billingStreet']), billingCity: str(data['billingCity']),
            billingState: str(data['billingState']), billingPostalCode: str(data['billingPostalCode']),
            billingCountry: str(data['billingCountry']), phone: str(data['phone']),
            fax: str(data['fax']), email: str(data['email']),
            tpSfId: str(data['tpSfId']), isCarrier: str(data['isCarrier']), isBroker: str(data['isBroker']),
        }).onConflictDoUpdate({ target: tmsCarrier.sfId, set: {
            traceId, replicaId, updatedAt: new Date(),
            displayName: str(data['displayName']), tmsType: str(data['tmsType']),
            billingStreet: str(data['billingStreet']), billingCity: str(data['billingCity']),
            billingState: str(data['billingState']), billingPostalCode: str(data['billingPostalCode']),
            billingCountry: str(data['billingCountry']), phone: str(data['phone']),
            fax: str(data['fax']), email: str(data['email']),
            tpSfId: str(data['tpSfId']), isCarrier: str(data['isCarrier']), isBroker: str(data['isBroker']),
        }}); return;
    }

    if (normalizedEntityType === 'TMS_VENDOR') {
        await txTyped.insert(tmsVendor).values({
            ...base,
            displayName: str(data['displayName']), tmsType: str(data['tmsType']),
            billingStreet: str(data['billingStreet']), billingCity: str(data['billingCity']),
            billingState: str(data['billingState']), billingPostalCode: str(data['billingPostalCode']),
            billingCountry: str(data['billingCountry']), phone: str(data['phone']),
            fax: str(data['fax']), email: str(data['email']),
            tpSfId: str(data['tpSfId']), isVendor: str(data['isVendor']),
        }).onConflictDoUpdate({ target: tmsVendor.sfId, set: {
            traceId, replicaId, updatedAt: new Date(),
            displayName: str(data['displayName']), tmsType: str(data['tmsType']),
            billingStreet: str(data['billingStreet']), billingCity: str(data['billingCity']),
            billingState: str(data['billingState']), billingPostalCode: str(data['billingPostalCode']),
            billingCountry: str(data['billingCountry']), phone: str(data['phone']),
            fax: str(data['fax']), email: str(data['email']),
            tpSfId: str(data['tpSfId']), isVendor: str(data['isVendor']),
        }}); return;
    }

    if (normalizedEntityType === 'TMS_CUSTOMER') {
        await txTyped.insert(tmsCustomer).values({
            ...base,
            displayName: str(data['displayName']), tmsType: str(data['tmsType']),
            billingStreet: str(data['billingStreet']), billingCity: str(data['billingCity']),
            billingState: str(data['billingState']), billingPostalCode: str(data['billingPostalCode']),
            billingCountry: str(data['billingCountry']), phone: str(data['phone']),
            fax: str(data['fax']), email: str(data['email']),
            creditLimit: str(data['creditLimit']), paymentTerms: str(data['paymentTerms']),
        }).onConflictDoUpdate({ target: tmsCustomer.sfId, set: {
            traceId, replicaId, updatedAt: new Date(),
            displayName: str(data['displayName']), tmsType: str(data['tmsType']),
            billingStreet: str(data['billingStreet']), billingCity: str(data['billingCity']),
            billingState: str(data['billingState']), billingPostalCode: str(data['billingPostalCode']),
            billingCountry: str(data['billingCountry']), phone: str(data['phone']),
            fax: str(data['fax']), email: str(data['email']),
            creditLimit: str(data['creditLimit']), paymentTerms: str(data['paymentTerms']),
        }}); return;
    }

    if (normalizedEntityType === 'TMS_FACTORING') {
        await txTyped.insert(tmsFactoring).values({
            ...base,
            displayName: str(data['displayName']), tmsType: str(data['tmsType']),
            billingStreet: str(data['billingStreet']), billingCity: str(data['billingCity']),
            billingState: str(data['billingState']), billingPostalCode: str(data['billingPostalCode']),
            billingCountry: str(data['billingCountry']), phone: str(data['phone']),
            fax: str(data['fax']), email: str(data['email']),
        }).onConflictDoUpdate({ target: tmsFactoring.sfId, set: {
            traceId, replicaId, updatedAt: new Date(),
            displayName: str(data['displayName']), tmsType: str(data['tmsType']),
            billingStreet: str(data['billingStreet']), billingCity: str(data['billingCity']),
            billingState: str(data['billingState']), billingPostalCode: str(data['billingPostalCode']),
            billingCountry: str(data['billingCountry']), phone: str(data['phone']),
            fax: str(data['fax']), email: str(data['email']),
        }}); return;
    }

    if (normalizedEntityType === 'TMS_ADDRESS') {
        await txTyped.insert(tmsAddress).values({
            ...base,
            displayName: str(data['displayName']), tmsType: str(data['tmsType']),
            billingStreet: str(data['billingStreet']), billingCity: str(data['billingCity']),
            billingState: str(data['billingState']), billingPostalCode: str(data['billingPostalCode']),
            billingCountry: str(data['billingCountry']), phone: str(data['phone']),
            fax: str(data['fax']), email: str(data['email']),
        }).onConflictDoUpdate({ target: tmsAddress.sfId, set: {
            traceId, replicaId, updatedAt: new Date(),
            displayName: str(data['displayName']), tmsType: str(data['tmsType']),
            billingStreet: str(data['billingStreet']), billingCity: str(data['billingCity']),
            billingState: str(data['billingState']), billingPostalCode: str(data['billingPostalCode']),
            billingCountry: str(data['billingCountry']), phone: str(data['phone']),
            fax: str(data['fax']), email: str(data['email']),
        }}); return;
    }

    if (normalizedEntityType === 'TMS_TP') {
        await txTyped.insert(tmsTp).values({
            ...base,
            mcNumber: str(data['mcNumber']), scac: str(data['scac']),
            federalTaxId: str(data['federalTaxId']), usdot: str(data['usdot']),
            remitToSfId: str(data['remitToSfId']), remitToOption: str(data['remitToOption']),
            carrierOperation: str(data['carrierOperation']), agreementStatus: str(data['agreementStatus']),
            carrierReviewStatus: str(data['carrierReviewStatus']),
        }).onConflictDoUpdate({ target: tmsTp.sfId, set: {
            traceId, replicaId, updatedAt: new Date(),
            mcNumber: str(data['mcNumber']), scac: str(data['scac']),
            federalTaxId: str(data['federalTaxId']), usdot: str(data['usdot']),
            remitToSfId: str(data['remitToSfId']), remitToOption: str(data['remitToOption']),
            carrierOperation: str(data['carrierOperation']), agreementStatus: str(data['agreementStatus']),
            carrierReviewStatus: str(data['carrierReviewStatus']),
        }}); return;
    }
    // Unknown type — normalized_entity already has it, skip typed write
};

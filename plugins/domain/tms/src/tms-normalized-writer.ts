import type { PluginPipelineHooks } from '@soopa/piece-framework';
import { validateTmsIdentifier } from './schema/tms-identifier-validator.js';
import { carrierWriter } from './writers/tms-carrier.writer.js';
import { vendorWriter } from './writers/tms-vendor.writer.js';
import { customerWriter } from './writers/tms-customer.writer.js';
import { factoringWriter } from './writers/tms-factoring.writer.js';
import { addressWriter } from './writers/tms-address.writer.js';
import { tpWriter } from './writers/tms-tp.writer.js';
import type { TmsWriterStrategy } from './writers/tms-writer-utils.js';

const writerStrategies: Record<string, TmsWriterStrategy> = {
    TMS_CARRIER: carrierWriter,
    TMS_VENDOR: vendorWriter,
    TMS_CUSTOMER: customerWriter,
    TMS_FACTORING: factoringWriter,
    TMS_ADDRESS: addressWriter,
    TMS_TP: tpWriter,
    TMS_LOAD: async (_tx, _schemaName, base, _data) => {
        throw new Error(`TMS normalized writer: type TMS_LOAD is recognized but not yet implemented (traceId=${base.traceId})`);
    },
    TMS_INVOICE: async (_tx, _schemaName, base, _data) => {
        throw new Error(`TMS normalized writer: type TMS_INVOICE is recognized but not yet implemented (traceId=${base.traceId})`);
    }
};

export const tmsNormalizedWriter: NonNullable<PluginPipelineHooks['writeNormalized']> = async (
    tx,
    _db,
    schemaName,
    replicaId,
    entityId,
    traceId,
    dataSourceId,
    normalizedEntityType,
    data,
) => {
    // Validate schemaName against SQL injection and Postgres limits
    validateTmsIdentifier(schemaName);

    const txTyped = tx as { execute: (query: unknown) => Promise<unknown> };
    const base = { traceId, replicaId, sourceId: entityId, dataSourceId };

    const strategy = writerStrategies[normalizedEntityType];
    if (strategy) {
        await strategy(txTyped, schemaName, base, data);
    }
    // Unknown type — normalized_entity already has it, skip typed write
};

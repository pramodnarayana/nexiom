import { TmsWriterStrategy, commonFields, str, upsert } from './tms-writer-utils.js';

export const carrierWriter: TmsWriterStrategy = async (tx, schemaName, base, data) => {
    await upsert(tx, schemaName, 'tms_carrier', base, {
        ...commonFields(data),
        tpSourceId: str(data['tpSourceId']),
        remitToSourceId: str(data['remitToSourceId']),
        isCarrier: str(data['isCarrier']),
        isBroker: str(data['isBroker']),
    });
};

import { TmsWriterStrategy, commonFields, str, upsert } from './tms-writer-utils.js';

export const addressWriter: TmsWriterStrategy = async (tx, schemaName, base, data) => {
    await upsert(tx, schemaName, 'tms_address', base, {
        ...commonFields(data),
        isPickup: str(data['isPickup']),
        isDelivery: str(data['isDelivery']),
    });
};

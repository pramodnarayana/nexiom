import { TmsWriterStrategy, commonFields, str, upsert } from './tms-writer-utils.js';

export const vendorWriter: TmsWriterStrategy = async (tx, schemaName, base, data) => {
    await upsert(tx, schemaName, 'tms_vendor', base, {
        ...commonFields(data),
        tpSourceId: str(data['tpSourceId']),
        isVendor: str(data['isVendor']),
    });
};

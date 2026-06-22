import { TmsWriterStrategy, commonFields, str, upsert } from './tms-writer-utils.js';

export const customerWriter: TmsWriterStrategy = async (tx, schemaName, base, data) => {
    await upsert(tx, schemaName, 'tms_customer', base, {
        ...commonFields(data),
        creditLimit: str(data['creditLimit']),
        paymentTerms: str(data['paymentTerms']),
    });
};

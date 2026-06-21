import { TmsWriterStrategy, commonFields, upsert } from './tms-writer-utils.js';

export const factoringWriter: TmsWriterStrategy = async (tx, schemaName, base, data) => {
    await upsert(tx, schemaName, 'tms_factoring', base, {
        ...commonFields(data),
    });
};

import { TmsWriterStrategy, str, upsert } from './tms-writer-utils.js';

export const tpWriter: TmsWriterStrategy = async (tx, schemaName, base, data) => {
    await upsert(tx, schemaName, 'tms_tp', base, {
        mcNumber: str(data['mcNumber']),
        usDotNumber: str(data['usDotNumber']),
        remitToOption: str(data['remitToOption']),
        invoiceTerms: str(data['invoiceTerms']),
        paymentTerms: str(data['paymentTerms']),
        carrierPaymentTerms: str(data['carrierPaymentTerms']),
        carrierRemitTo: str(data['carrierRemitTo']),
        companyType: str(data['companyType']),
        creditLimit: str(data['creditLimit']),
        stateDotNumber: str(data['stateDotNumber']),
    });
};

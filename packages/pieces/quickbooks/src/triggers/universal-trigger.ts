import { createTrigger, TriggerStrategy, type TriggerContext, Property } from '@nexiom/connectors/framework';
import { quickbooksAuth } from '../index.js';
import { QuickBooksAuth, runQuickBooksQuery } from './quickbooks-polling.helper.js';
import { optimizationService } from '@nexiom/connectors/intelligence';

const QB_SUPPORTED_ENTITIES = [
    'Account', 'Attachable', 'Bill', 'BillPayment', 'Class', 'CompanyInfo', 'CreditMemo',
    'Customer', 'Department', 'Deposit', 'Employee', 'Estimate', 'ExchangeRate', 'Invoice',
    'Item', 'JournalEntry', 'Payment', 'PaymentMethod', 'Preferences', 'Purchase', 'PurchaseOrder',
    'RefundReceipt', 'SalesReceipt', 'TaxAgency', 'TaxCode', 'TaxRate', 'TaxService', 'Term',
    'TimeActivity', 'Transfer', 'Vendor', 'VendorCredit'
];

export const quickbooksUniversalTrigger = createTrigger({
    name: 'universal_trigger',
    displayName: 'New or Updated Record (Any Entity)',
    description: 'Fires when any QuickBooks entity is created or updated.',
    type: TriggerStrategy.POLLING,
    auth: quickbooksAuth,
    props: {
        entity: Property.StaticDropdown({
            displayName: 'Entity',
            required: true,
            options: {
                options: QB_SUPPORTED_ENTITIES.map(e => ({ label: e, value: e })),
            },
        }),
    },
    async run(context: TriggerContext) {
        const { auth, propsValue, store } = context;
        const entity = propsValue.entity as string;

        // Fetch DB-backed hint
        const hint = await optimizationService.getHint('quickbooks', entity);

        // Ensure auth matches QuickBooksAuth shape
        const qboAuth = auth as unknown as QuickBooksAuth;
        return runQuickBooksQuery(qboAuth, entity, store, hint);
    },
    async onEnable() {
        return;
    },
    async onDisable() {
        return;
    },
});

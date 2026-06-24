import {
    pgTable,
    uuid,
    varchar,
    timestamp,
    index,
    uniqueIndex,
    text,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const common = {
    id:        uuid('id').defaultRandom().primaryKey(),
    traceId:   uuid('trace_id').notNull(),
    replicaId: uuid('replica_id').notNull(),
    dataSourceId: varchar('data_source_id', { length: 255 }).notNull(),
    sourceId:  varchar('source_id', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
};

const address = {
    billingStreet:     varchar('billing_street', { length: 500 }),
    billingCity:       varchar('billing_city', { length: 100 }),
    billingState:      varchar('billing_state', { length: 100 }),
    billingPostalCode: varchar('billing_postal_code', { length: 20 }),
    billingCountry:    varchar('billing_country', { length: 100 }),
};

const contact = {
    phone: varchar('phone', { length: 50 }),
    fax:   varchar('fax', { length: 50 }),
    email: varchar('email', { length: 255 }),
};

export const tmsCarrier = pgTable('tms_carrier', {
    ...common,
    displayName: varchar('display_name', { length: 255 }),
    tmsType:     varchar('tms_type', { length: 100 }),
    ...address,
    ...contact,
    tpSourceId: varchar('tp_source_id', { length: 255 }),
    remitToSourceId: varchar('remit_to_source_id', { length: 255 }),
    isCarrier: text('is_carrier'),
    isBroker:  text('is_broker'),
}, (t) => [
    uniqueIndex('uq_tms_carrier_composite').on(t.dataSourceId, t.sourceId),
    index('idx_tms_carrier_tp').on(t.tpSourceId).where(sql`${t.tpSourceId} IS NOT NULL`),
    index('idx_tms_carrier_trace').on(t.traceId),
]);

export const tmsVendor = pgTable('tms_vendor', {
    ...common,
    displayName: varchar('display_name', { length: 255 }),
    tmsType:     varchar('tms_type', { length: 100 }),
    ...address,
    ...contact,
    tpSourceId: varchar('tp_source_id', { length: 255 }),
    isVendor: text('is_vendor'),
}, (t) => [
    uniqueIndex('uq_tms_vendor_composite').on(t.dataSourceId, t.sourceId),
    index('idx_tms_vendor_tp').on(t.tpSourceId).where(sql`${t.tpSourceId} IS NOT NULL`),
    index('idx_tms_vendor_trace').on(t.traceId),
]);

export const tmsCustomer = pgTable('tms_customer', {
    ...common,
    displayName: varchar('display_name', { length: 255 }),
    tmsType:     varchar('tms_type', { length: 100 }),
    ...address,
    ...contact,
    creditLimit: varchar('credit_limit', { length: 50 }),
    paymentTerms: varchar('payment_terms', { length: 100 }),
}, (t) => [
    uniqueIndex('uq_tms_customer_composite').on(t.dataSourceId, t.sourceId),
    index('idx_tms_customer_trace').on(t.traceId),
]);

export const tmsFactoring = pgTable('tms_factoring', {
    ...common,
    displayName: varchar('display_name', { length: 255 }),
    tmsType:     varchar('tms_type', { length: 100 }),
    ...address,
    ...contact,
    paymentTerms: varchar('payment_terms', { length: 100 }),
    mcNumber: varchar('mc_number', { length: 50 }),
    usDotNumber: varchar('us_dot_number', { length: 50 }),
}, (t) => [
    uniqueIndex('uq_tms_factoring_composite').on(t.dataSourceId, t.sourceId),
    index('idx_tms_factoring_trace').on(t.traceId),
]);

export const tmsAddress = pgTable('tms_address', {
    ...common,
    displayName: varchar('display_name', { length: 255 }),
    tmsType:     varchar('tms_type', { length: 100 }),
    ...address,
    ...contact,
    isPickup: text('is_pickup'),
    isDelivery: text('is_delivery'),
}, (t) => [
    uniqueIndex('uq_tms_address_composite').on(t.dataSourceId, t.sourceId),
    index('idx_tms_address_trace').on(t.traceId),
]);

export const tmsTp = pgTable('tms_tp', {
    ...common,
    invoiceTerms: varchar('invoice_terms', { length: 100 }),
    paymentTerms: varchar('payment_terms', { length: 100 }),
    carrierPaymentTerms: varchar('carrier_payment_terms', { length: 100 }),
    carrierRemitTo: varchar('carrier_remit_to', { length: 255 }),
    companyType: varchar('company_type', { length: 100 }),
    creditLimit: varchar('credit_limit', { length: 50 }),
    remitToOption: varchar('remit_to_option', { length: 100 }),
    mcNumber: varchar('mc_number', { length: 50 }),
    stateDotNumber: varchar('state_dot_number', { length: 50 }),
    usDotNumber: varchar('us_dot_number', { length: 50 }),
}, (t) => [
    uniqueIndex('uq_tms_tp_composite').on(t.dataSourceId, t.sourceId),
    index('idx_tms_tp_remit_to').on(t.carrierRemitTo).where(sql`${t.carrierRemitTo} IS NOT NULL`),
    index('idx_tms_tp_trace').on(t.traceId),
]);

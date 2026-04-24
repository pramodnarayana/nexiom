import {
    pgSchema,
    uuid,
    varchar,
    timestamp,
    index,
    uniqueIndex,
    text,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * buildTmsSchema(schemaName)
 *
 * TMS domain schema builder — part of @nexiom/domain-tms.
 *
 * Shared by ALL TMS source connectors (Revenova, McLeod, TMW, etc.).
 * No connector-specific code lives here — only the canonical TMS
 * data model that any TMS integration writes to.
 *
 * Tables:
 *   tms_carrier   — Carrier Accounts
 *   tms_vendor    — Vendor Accounts (non-carrier service providers)
 *   tms_customer  — Customer Accounts (freight payers)
 *   tms_factoring — Factoring company Accounts
 *   tms_address   — Shipper/Consignee Accounts (origin/destination)
 *   tms_tp        — Transportation Profile (linked to Carrier/Vendor)
 *
 * Natural key on all tables: sf_id — idempotent upsert target.
 *
 * JOIN chain for QB Vendor payload:
 *   tms_carrier.tp_sf_id → tms_tp.sf_id
 *   tms_tp.remit_to_sf_id → tms_carrier.sf_id | tms_factoring.sf_id
 */
export function buildTmsSchema(schemaName: string) {
    const schema = pgSchema(schemaName);

    const common = {
        id:        uuid('id').defaultRandom().primaryKey(),
        traceId:   uuid('trace_id').notNull(),
        replicaId: uuid('replica_id').notNull(),
        sfId:      varchar('sf_id', { length: 255 }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
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

    // ── tms_carrier ───────────────────────────────────────────────────────────
    const tmsCarrier = schema.table('tms_carrier', {
        ...common,
        displayName: varchar('display_name', { length: 255 }),
        tmsType:     varchar('tms_type', { length: 100 }),
        ...address,
        ...contact,
        tpSfId:    varchar('tp_sf_id', { length: 255 }),
        isCarrier: text('is_carrier'),
        isBroker:  text('is_broker'),
    }, (t) => [
        uniqueIndex('uq_tms_carrier_sf_id').on(t.sfId),
        index('idx_tms_carrier_tp').on(t.tpSfId).where(sql`${t.tpSfId} IS NOT NULL`),
        index('idx_tms_carrier_trace').on(t.traceId),
    ]);

    // ── tms_vendor ────────────────────────────────────────────────────────────
    const tmsVendor = schema.table('tms_vendor', {
        ...common,
        displayName: varchar('display_name', { length: 255 }),
        tmsType:     varchar('tms_type', { length: 100 }),
        ...address,
        ...contact,
        tpSfId:   varchar('tp_sf_id', { length: 255 }),
        isVendor: text('is_vendor'),
    }, (t) => [
        uniqueIndex('uq_tms_vendor_sf_id').on(t.sfId),
        index('idx_tms_vendor_tp').on(t.tpSfId).where(sql`${t.tpSfId} IS NOT NULL`),
        index('idx_tms_vendor_trace').on(t.traceId),
    ]);

    // ── tms_customer ──────────────────────────────────────────────────────────
    const tmsCustomer = schema.table('tms_customer', {
        ...common,
        displayName:  varchar('display_name', { length: 255 }),
        tmsType:      varchar('tms_type', { length: 100 }),
        ...address,
        ...contact,
        creditLimit:  varchar('credit_limit', { length: 50 }),
        paymentTerms: varchar('payment_terms', { length: 100 }),
    }, (t) => [
        uniqueIndex('uq_tms_customer_sf_id').on(t.sfId),
        index('idx_tms_customer_trace').on(t.traceId),
    ]);

    // ── tms_factoring ─────────────────────────────────────────────────────────
    const tmsFactoring = schema.table('tms_factoring', {
        ...common,
        displayName: varchar('display_name', { length: 255 }),
        tmsType:     varchar('tms_type', { length: 100 }),
        ...address,
        ...contact,
    }, (t) => [
        uniqueIndex('uq_tms_factoring_sf_id').on(t.sfId),
        index('idx_tms_factoring_trace').on(t.traceId),
    ]);

    // ── tms_address ───────────────────────────────────────────────────────────
    const tmsAddress = schema.table('tms_address', {
        ...common,
        displayName: varchar('display_name', { length: 255 }),
        tmsType:     varchar('tms_type', { length: 100 }),
        ...address,
        ...contact,
        isPickup:   text('is_pickup'),
        isDelivery: text('is_delivery'),
    }, (t) => [
        uniqueIndex('uq_tms_address_sf_id').on(t.sfId),
        index('idx_tms_address_trace').on(t.traceId),
    ]);

    // ── tms_tp ────────────────────────────────────────────────────────────────
    const tmsTp = schema.table('tms_tp', {
        ...common,
        mcNumber:            varchar('mc_number', { length: 50 }),
        scac:                varchar('scac', { length: 20 }),
        federalTaxId:        varchar('federal_tax_id', { length: 50 }),
        usdot:               varchar('usdot', { length: 50 }),
        remitToSfId:         varchar('remit_to_sf_id', { length: 255 }),
        remitToOption:       varchar('remit_to_option', { length: 100 }),
        carrierOperation:    varchar('carrier_operation', { length: 100 }),
        agreementStatus:     varchar('agreement_status', { length: 100 }),
        carrierReviewStatus: varchar('carrier_review_status', { length: 100 }),
    }, (t) => [
        uniqueIndex('uq_tms_tp_sf_id').on(t.sfId),
        index('idx_tms_tp_remit_to').on(t.remitToSfId).where(sql`${t.remitToSfId} IS NOT NULL`),
        index('idx_tms_tp_trace').on(t.traceId),
    ]);

    return { tmsCarrier, tmsVendor, tmsCustomer, tmsFactoring, tmsAddress, tmsTp };
}

export type TmsSchema = ReturnType<typeof buildTmsSchema>;

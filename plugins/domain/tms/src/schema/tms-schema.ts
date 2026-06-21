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
 * Allowed schema name pattern — must be provisioned by DBManager.
 * Enforced before calling pgSchema() to prevent SQL injection.
 */
const TENANT_SCHEMA_PATTERN = /^ws_[a-z0-9_]+$/;

/**
 * Validates that a schema name is safe to pass to pgSchema().
 * Throws if the name is invalid or oversized.
 */
function validateSchemaName(schemaName: string): void {
    if (!schemaName) {
        throw new Error('Schema name cannot be empty');
    }
    if (schemaName.length > 63) {
        throw new Error(
            `Schema name "${schemaName}" exceeds PostgreSQL identifier limit of 63 characters`
        );
    }
    if (!TENANT_SCHEMA_PATTERN.test(schemaName)) {
        throw new Error(
            `Invalid schema name "${schemaName}". ` +
            `Must match ${TENANT_SCHEMA_PATTERN.toString()} — only DBManager-provisioned names are allowed.`
        );
    }
}

/**
 * buildTmsSchema(schemaName)
 *
 * TMS domain schema builder — part of @soopa/domain-tms.
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
 * Natural key on all tables: source_id — idempotent upsert target.
 *
 * JOIN chain for QB Vendor payload:
 *   tms_carrier.tp_source_id → tms_tp.source_id
 *   tms_tp.carrier_remit_to → tms_carrier.source_id | tms_factoring.source_id
 *
 * ⚠️ SYNC WARNING: This schema MUST stay in sync with the DDL in provisionTmsTables (tms-provisioner.ts).
 * When updating this builder, also update the corresponding DDL in provisionTmsTables:
 *   - Unique index name pattern: uq_tms_*_source_id
 *   - Partial index predicates on tp_source_id / carrier_remit_to (WHERE ... IS NOT NULL)
 *   - Boolean-like text columns: is_carrier, is_broker, is_vendor, is_pickup, is_delivery
 * provisionTmsTables and buildTmsSchema are authoritative sources — keep them aligned.
 */
/* v8 ignore start */
export function buildTmsSchema(schemaName: string) {
    validateSchemaName(schemaName);
    const schema = pgSchema(schemaName);

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

    // ── tms_carrier ───────────────────────────────────────────────────────────
    const tmsCarrier = schema.table('tms_carrier', {
        ...common,
        displayName: varchar('display_name', { length: 255 }),
        tmsType:     varchar('tms_type', { length: 100 }),
        ...address,
        ...contact,
        tpSourceId:    varchar('tp_source_id', { length: 255 }),
        remitToSourceId: varchar('remit_to_source_id', { length: 255 }),
        isCarrier: text('is_carrier'),
        isBroker:  text('is_broker'),
    }, (t) => [
        uniqueIndex('uq_tms_carrier_composite').on(t.dataSourceId, t.sourceId),
        index('idx_tms_carrier_tp').on(t.tpSourceId).where(sql`${t.tpSourceId} IS NOT NULL`),
        index('idx_tms_carrier_trace').on(t.traceId),
    ]);

    // ── tms_vendor ────────────────────────────────────────────────────────────
    const tmsVendor = schema.table('tms_vendor', {
        ...common,
        displayName: varchar('display_name', { length: 255 }),
        tmsType:     varchar('tms_type', { length: 100 }),
        ...address,
        ...contact,
        tpSourceId:   varchar('tp_source_id', { length: 255 }),
        isVendor: text('is_vendor'),
    }, (t) => [
        uniqueIndex('uq_tms_vendor_composite').on(t.dataSourceId, t.sourceId),
        index('idx_tms_vendor_tp').on(t.tpSourceId).where(sql`${t.tpSourceId} IS NOT NULL`),
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
        uniqueIndex('uq_tms_customer_composite').on(t.dataSourceId, t.sourceId),
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
        uniqueIndex('uq_tms_factoring_composite').on(t.dataSourceId, t.sourceId),
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
        uniqueIndex('uq_tms_address_composite').on(t.dataSourceId, t.sourceId),
        index('idx_tms_address_trace').on(t.traceId),
    ]);

    // ── tms_tp ────────────────────────────────────────────────────────────────
    const tmsTp = schema.table('tms_tp', {
        ...common,
        invoiceTerms:        varchar('invoice_terms', { length: 100 }),
        paymentTerms:        varchar('payment_terms', { length: 100 }),
        carrierPaymentTerms: varchar('carrier_payment_terms', { length: 100 }),
        carrierRemitTo:      varchar('carrier_remit_to', { length: 255 }),
        companyType:         varchar('company_type', { length: 100 }),
        creditLimit:         varchar('credit_limit', { length: 50 }),
        remitToOption:       varchar('remit_to_option', { length: 100 }),
        mcNumber:            varchar('mc_number', { length: 50 }),
        stateDotNumber:      varchar('state_dot_number', { length: 50 }),
        usDotNumber:         varchar('us_dot_number', { length: 50 }),
    }, (t) => [
        uniqueIndex('uq_tms_tp_composite').on(t.dataSourceId, t.sourceId),
        index('idx_tms_tp_remit_to').on(t.carrierRemitTo).where(sql`${t.carrierRemitTo} IS NOT NULL`),
        index('idx_tms_tp_trace').on(t.traceId),
    ]);

    return { tmsCarrier, tmsVendor, tmsCustomer, tmsFactoring, tmsAddress, tmsTp };
}
/* v8 ignore stop */

export type TmsSchema = ReturnType<typeof buildTmsSchema>;

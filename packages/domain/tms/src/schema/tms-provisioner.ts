import type { DrizzleDb } from '@nexiom/database';
import { sql } from 'drizzle-orm';

/**
 * provisionTmsTables(db, schemaName)
 *
 * Idempotent DDL for TMS domain tables — part of @nexiom/domain-tms.
 * Shared by ALL TMS connectors. Called when a TMS connector stitch is
 * first activated for a tenant schema.
 */
export async function provisionTmsTables(db: DrizzleDb, schemaName: string): Promise<void> {
    // Validate schemaName against SQL injection
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schemaName)) {
        throw new Error(
            `Invalid schemaName "${schemaName}" — must contain only letters, digits, and underscores, and not start with a digit`
        );
    }

    const COMMON = `
        id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        trace_id    UUID         NOT NULL,
        replica_id  UUID         NOT NULL,
        sf_id       VARCHAR(255) NOT NULL,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    `;
    const ADDR = `
        billing_street      VARCHAR(500),
        billing_city        VARCHAR(100),
        billing_state       VARCHAR(100),
        billing_postal_code VARCHAR(20),
        billing_country     VARCHAR(100)
    `;
    const CONTACT = `phone VARCHAR(50), fax VARCHAR(50), email VARCHAR(255)`;

    // Wrap all DDL in a single drizzle transaction for atomicity
    await db.transaction(async (tx) => {
        await tx.execute(sql.raw(`CREATE TABLE IF NOT EXISTS "${schemaName}".tms_carrier (
            ${COMMON}, display_name VARCHAR(255), tms_type VARCHAR(100),
            ${ADDR}, ${CONTACT}, tp_sf_id VARCHAR(255), is_carrier TEXT, is_broker TEXT,
            CONSTRAINT uq_tms_carrier_sf_id UNIQUE (sf_id));`));
        await tx.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_tms_carrier_tp    ON "${schemaName}".tms_carrier (tp_sf_id) WHERE tp_sf_id IS NOT NULL;`));
        await tx.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_tms_carrier_trace ON "${schemaName}".tms_carrier (trace_id);`));

        await tx.execute(sql.raw(`CREATE TABLE IF NOT EXISTS "${schemaName}".tms_vendor (
            ${COMMON}, display_name VARCHAR(255), tms_type VARCHAR(100),
            ${ADDR}, ${CONTACT}, tp_sf_id VARCHAR(255), is_vendor TEXT,
            CONSTRAINT uq_tms_vendor_sf_id UNIQUE (sf_id));`));
        await tx.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_tms_vendor_tp    ON "${schemaName}".tms_vendor (tp_sf_id) WHERE tp_sf_id IS NOT NULL;`));
        await tx.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_tms_vendor_trace ON "${schemaName}".tms_vendor (trace_id);`));

        await tx.execute(sql.raw(`CREATE TABLE IF NOT EXISTS "${schemaName}".tms_customer (
            ${COMMON}, display_name VARCHAR(255), tms_type VARCHAR(100),
            ${ADDR}, ${CONTACT}, credit_limit VARCHAR(50), payment_terms VARCHAR(100),
            CONSTRAINT uq_tms_customer_sf_id UNIQUE (sf_id));`));
        await tx.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_tms_customer_trace ON "${schemaName}".tms_customer (trace_id);`));

        await tx.execute(sql.raw(`CREATE TABLE IF NOT EXISTS "${schemaName}".tms_factoring (
            ${COMMON}, display_name VARCHAR(255), tms_type VARCHAR(100),
            ${ADDR}, ${CONTACT},
            CONSTRAINT uq_tms_factoring_sf_id UNIQUE (sf_id));`));
        await tx.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_tms_factoring_trace ON "${schemaName}".tms_factoring (trace_id);`));

        await tx.execute(sql.raw(`CREATE TABLE IF NOT EXISTS "${schemaName}".tms_address (
            ${COMMON}, display_name VARCHAR(255), tms_type VARCHAR(100),
            ${ADDR}, ${CONTACT}, is_pickup TEXT, is_delivery TEXT,
            CONSTRAINT uq_tms_address_sf_id UNIQUE (sf_id));`));
        await tx.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_tms_address_trace ON "${schemaName}".tms_address (trace_id);`));

        await tx.execute(sql.raw(`CREATE TABLE IF NOT EXISTS "${schemaName}".tms_tp (
            ${COMMON}, mc_number VARCHAR(50), scac VARCHAR(20), federal_tax_id VARCHAR(50),
            usdot VARCHAR(50), remit_to_sf_id VARCHAR(255), remit_to_option VARCHAR(100),
            carrier_operation VARCHAR(100), agreement_status VARCHAR(100), carrier_review_status VARCHAR(100),
            CONSTRAINT uq_tms_tp_sf_id UNIQUE (sf_id));`));
        await tx.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_tms_tp_remit_to ON "${schemaName}".tms_tp (remit_to_sf_id) WHERE remit_to_sf_id IS NOT NULL;`));
        await tx.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_tms_tp_trace    ON "${schemaName}".tms_tp (trace_id);`));
    });
}

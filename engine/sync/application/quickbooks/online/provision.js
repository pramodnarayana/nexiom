"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.provisionQBDomain = provisionQBDomain;
/**
 * No domain schema to provision for QuickBooks as a destination.
 * It does not have custom tables like tms_carrier.
 */
async function provisionQBDomain(_db, _schemaName) {
    // No-op for now. If QB requires specific destination tracking tables, 
    // they would be created here.
}

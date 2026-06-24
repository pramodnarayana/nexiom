/**
 * Config Applicator — applies StitchConfig behavioral flags to a built payload.
 *
 * Called by Mapper.build() AFTER all field mapping rules have been
 * applied. It layers customer-specific behavioral overrides on top of the
 * field-mapped payload.
 *
 * Config flags are defined per piece via piece.describeConfig(). This module
 * reads the config schema and acts on known flag names. Unknown keys are
 * silently ignored (forward-compatible).
 *
 * Examples:
 *   useTaxCode: true  → adds TxnTaxDetail block to QuickBooks payload
 *   currencyOverride   → overrides CurrencyRef.value
 *   duplicateStrategy  → "reject" | "allow" (read by DeliveryService, not here)
 */

import type { StitchConfig } from './mapping.types.js';

export interface ApplicatorResult {
  payload: Record<string, unknown>;
  warnings: string[];
}

/**
 * apply — mutates the payload in-place based on stitchConfig flags.
 *
 * @param payload   The field-mapped target JSON (output of field mapping step)
 * @param config    The stitch's behavioral configuration
 * @returns         { payload, warnings } — payload is the same object (mutated)
 */
export function apply(
  payload: Record<string, unknown>,
  config: StitchConfig,
): ApplicatorResult {
  const warnings: string[] = [];

  // ── Tax Code ───────────────────────────────────────────────────────────────
  if (config['useTaxCode'] === true) {
    const taxCode = config['taxCodeDefault'];
    if (!taxCode) {
      warnings.push(
        'useTaxCode is true but taxCodeDefault is not set — TxnTaxDetail skipped',
      );
    } else {
      payload['TxnTaxDetail'] = { TaxCode: taxCode };
    }
  }

  // ── Currency Override ──────────────────────────────────────────────────────
  if (config['currencyOverride']) {
    const currencyRef = payload['CurrencyRef'];
    if (currencyRef && typeof currencyRef === 'object' && !Array.isArray(currencyRef)) {
      (currencyRef as Record<string, unknown>)['value'] = config['currencyOverride'];
    } else {
      payload['CurrencyRef'] = { value: config['currencyOverride'] };
    }
  }

  // ── Date Format ────────────────────────────────────────────────────────────
  // Note: dateFormat is applied per field via FormulaLibrary at the field level.
  // A global dateFormat in stitchConfig serves as the default for unformatted date fields.
  // Future: iterate known date fields and apply format if not already formatted.

  return { payload, warnings };
}

/**
 * @nexiom/mapping — Shared types for the Standard Execution Engine.
 *
 * These types are the contract between:
 *  - The API (which stores mapping expressions in field_mapping table)
 *  - The UI canvas (which produces MappingRule[] from field connections + formula picker)
 *  - The Worker FanOutService (which calls MappingEngine.build())
 *
 * ## How JSONata fits in
 *
 * The `expression` field in `MappingRule` is a JSONata expression string.
 * JSONata is evaluated at runtime against the full Canonical Composite JSON.
 * The user NEVER writes JSONata — the canvas formula picker generates it.
 *
 * Formula picker → JSONata expression (invisible to user):
 *   "Date Format (DD/MM/YYYY)"  → $fromMillis($toMillis(invoiceDate), '[D01]/[M01]/[Y0001]')
 *   "Uppercase"                 → $uppercase(Account.Name)
 *   "Concatenate"               → firstName & ' ' & lastName
 *   "Round (2dp)"               → $round(amount, 2)
 *
 * See: https://docs.jsonata.org/simple for the full function reference.
 */

/**
 * A single field mapping rule.
 * Produced by the Mapping Canvas and stored in the field_mapping table (one row per rule).
 *
 * Simple copy (no expression):
 *   { srcPath: 'Account.TaxId', destPath: 'VendorRef.TaxIdentifier' }
 *   → extracts compositeJson.Account.TaxId and writes to payload.VendorRef.TaxIdentifier
 *
 * JSONata transform:
 *   { srcPath: 'invoiceDate', destPath: 'TxnDate',
 *     expression: "$fromMillis($toMillis(invoiceDate), '[D01]/[M01]/[Y0001]')" }
 *   → evaluates the expression against the full compositeJson, writes result to TxnDate
 *   → srcPath is used by the UI only (to show which source field is "connected")
 *
 * Multi-source expression (srcPath is UI-only metadata):
 *   { srcPath: 'firstName', destPath: 'DisplayName',
 *     expression: "firstName & ' ' & lastName" }
 */
export interface MappingRule {
  /**
   * Dot-notation path into the Canonical Composite JSON.
   * Used directly for field extraction when no `expression` is set.
   * When `expression` is set, this is UI display metadata only — the expression
   * has full access to the compositeJson context.
   * e.g. "data.Account.TaxId", "Load.TotalWeight"
   */
  srcPath: string;

  /**
   * Dot-notation path in the target payload where the result is written.
   * e.g. "VendorRef.TaxIdentifier", "TxnDate"
   */
  destPath: string;

  /**
   * Optional JSONata expression to transform the value.
   * Evaluated against the full compositeJson as context.
   * When absent, the value at srcPath is copied directly to destPath.
   *
   * The JSONata expression has access to all fields in compositeJson
   * and the full Jsonata standard library (70+ functions).
   * Nexiom domain extensions are registered via jsonata-extensions.ts.
   */
  expression?: string;
}

/**
 * Per-stitch behavioral configuration.
 * Stored as a JSONB blob on integration_stitch.config.
 * Set by the customer via the Configuration tab (T023 Step 3, Tab B).
 *
 * Examples of keys a piece's describeConfig() might define:
 *   useTaxCode: boolean
 *   taxCodeDefault: string
 *   currencyOverride: string
 *   duplicateStrategy: "reject" | "allow"
 *   dateFormat: string
 */
export type StitchConfig = Record<string, unknown>;

/**
 * Input to MappingEngine.build().
 */
export interface MappingInput {
  /**
   * The Canonical Composite JSON assembled at L4.
   * Contains the root entity + all related entities keyed by entity_type.
   * This is the single source of truth — all MappingRule expressions are
   * evaluated against this object.
   */
  compositeJson: Record<string, unknown>;

  /**
   * Field mapping rules for this stitch, loaded from the field_mapping table.
   *
   * Each rule maps a source field to a target field, with an optional JSONata
   * expression transform in between.
   *
   * When `mappingRules` is **empty**, `MappingEngine.build()` produces an
   * **empty payload** `{}` — there is no implicit pass-through of
   * `compositeJson`. This is intentional: an unconfigured stitch should
   * deliver nothing rather than inadvertently forwarding raw internal data
   * to the destination API.
   */
  mappingRules: MappingRule[];

  /**
   * Per-stitch behavioral flags from integration_stitch.config.
   * Applied after field mapping by ConfigApplicator.
   */
  stitchConfig: StitchConfig;
}

/**
 * Result returned by MappingEngine.build().
 */
export interface MappingResult {
  /** The assembled target JSON payload ready for delivery (L5). */
  payload: Record<string, unknown>;

  /**
   * Non-fatal warnings generated during mapping.
   * e.g. a srcPath that resolved to undefined, a JSONata expression that failed.
   * These are logged but do not halt the pipeline.
   */
  warnings: string[];
}

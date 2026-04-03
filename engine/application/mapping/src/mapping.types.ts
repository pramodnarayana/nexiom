/**
 * @nexiom/mapping — Shared types for the Standard Execution Engine.
 *
 * These types are the contract between:
 *  - The API (which stores MappingRules in field_mapping table)
 *  - The UI (which produces Mapping Config from the canvas)
 *  - The Worker FanOutService (which calls MappingEngine.build())
 */

/**
 * A formula to apply to a source value before writing to the target field.
 * All available formulas are registered in FORMULA_REGISTRY (formula-library.ts).
 */
export interface FormulaRef {
  /** Registered formula name — e.g. "dateFormat", "concat", "unitConvert" */
  name: string;
  /** Named arguments passed to the formula — e.g. { format: "DD/MM/YYYY" } */
  args: Record<string, unknown>;
}

/**
 * A single field mapping rule.
 * Produced by the Mapping Canvas and stored in the field_mapping table.
 *
 * srcPath  — dot-notation JSON path into the Canonical Composite JSON
 *            e.g. "data.Account.TaxId" (never shown to the user — they see the label)
 * destPath — dot-notation JSON path in the target payload
 *            e.g. "VendorRef.TaxIdentifier"
 * formula  — optional transform applied to the source value before mapping
 */
export interface MappingRule {
  srcPath: string;
  destPath: string;
  formula?: FormulaRef;
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
   * This is the single source of truth — mapping scripts never need DB lookups.
   */
  compositeJson: Record<string, unknown>;

  /**
   * Field mapping rules loaded from the field_mapping table for this stitch.
   * If empty, the engine returns the raw compositeJson (pass-through).
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
   * e.g. a srcPath that resolved to undefined, an optional formula arg missing.
   * These are logged but do not halt the pipeline.
   */
  warnings: string[];
}

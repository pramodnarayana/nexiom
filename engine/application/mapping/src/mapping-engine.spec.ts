import { describe, it, expect, beforeEach } from 'vitest';
import { MappingEngine } from './mapping-engine.js';
import type { MappingRule, StitchConfig } from './mapping.types.js';

let engine: MappingEngine;

beforeEach(() => {
  engine = new MappingEngine();
});

// ─── Simple Field Copy ────────────────────────────────────────────────────────

describe('MappingEngine — simple field copy (no expression)', () => {
  it('copies a top-level field to a top-level destPath', async () => {
    const result = await engine.build({
      compositeJson: { amount: 1500 },
      mappingRules: [{ srcPath: 'amount', destPath: 'TotalAmt' }],
      stitchConfig: {},
    });
    expect(result.payload['TotalAmt']).toBe(1500);
    expect(result.warnings).toHaveLength(0);
  });

  it('copies a nested srcPath to a nested destPath using dot notation', async () => {
    const result = await engine.build({
      compositeJson: { Account: { TaxId: 'TX-001' } },
      mappingRules: [{ srcPath: 'Account.TaxId', destPath: 'VendorRef.TaxIdentifier' }],
      stitchConfig: {},
    });
    expect((result.payload['VendorRef'] as Record<string, unknown>)['TaxIdentifier']).toBe('TX-001');
  });

  it('handles multiple rules independently', async () => {
    const rules: MappingRule[] = [
      { srcPath: 'Load.TotalWeight', destPath: 'TotalAmt' },
      { srcPath: 'Load.RefNumber', destPath: 'DocNumber' },
    ];
    const result = await engine.build({
      compositeJson: { Load: { TotalWeight: 200, RefNumber: 'REF-42' } },
      mappingRules: rules,
      stitchConfig: {},
    });
    expect(result.payload['TotalAmt']).toBe(200);
    expect(result.payload['DocNumber']).toBe('REF-42');
  });

  it('emits a warning and skips field when srcPath resolves to undefined', async () => {
    const result = await engine.build({
      compositeJson: { amount: 100 },
      mappingRules: [{ srcPath: 'nonExistent.field', destPath: 'TotalAmt' }],
      stitchConfig: {},
    });
    expect(result.payload['TotalAmt']).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('nonExistent.field');
  });

  it('returns empty payload with no warnings when mappingRules is empty', async () => {
    const result = await engine.build({
      compositeJson: { amount: 100 },
      mappingRules: [],
      stitchConfig: {},
    });
    expect(Object.keys(result.payload)).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

// ─── JSONata Expressions ──────────────────────────────────────────────────────

describe('MappingEngine — JSONata expressions', () => {
  it('evaluates a simple field reference expression', async () => {
    const result = await engine.build({
      compositeJson: { name: 'Acme Corp' },
      mappingRules: [{ srcPath: 'name', destPath: 'CompanyName', expression: 'name' }],
      stitchConfig: {},
    });
    expect(result.payload['CompanyName']).toBe('Acme Corp');
  });

  it('applies $uppercase() builtin', async () => {
    const result = await engine.build({
      compositeJson: { name: 'acme corp' },
      mappingRules: [{ srcPath: 'name', destPath: 'CompanyName', expression: '$uppercase(name)' }],
      stitchConfig: {},
    });
    expect(result.payload['CompanyName']).toBe('ACME CORP');
  });

  it('applies $lowercase() builtin', async () => {
    const result = await engine.build({
      compositeJson: { email: 'Admin@Example.COM' },
      mappingRules: [{ srcPath: 'email', destPath: 'Email', expression: '$lowercase(email)' }],
      stitchConfig: {},
    });
    expect(result.payload['Email']).toBe('admin@example.com');
  });

  it('concatenates two fields using & operator', async () => {
    const result = await engine.build({
      compositeJson: { firstName: 'John', lastName: 'Doe' },
      mappingRules: [
        {
          srcPath: 'firstName',
          destPath: 'DisplayName',
          expression: "firstName & ' ' & lastName",
        },
      ],
      stitchConfig: {},
    });
    expect(result.payload['DisplayName']).toBe('John Doe');
  });

  it('formats a date using $fromMillis and $toMillis', async () => {
    const result = await engine.build({
      compositeJson: { invoiceDate: '2024-01-30T00:00:00.000Z' },
      mappingRules: [
        {
          srcPath: 'invoiceDate',
          destPath: 'TxnDate',
          expression: "$fromMillis($toMillis(invoiceDate), '[D01]/[M01]/[Y0001]')",
        },
      ],
      stitchConfig: {},
    });
    expect(result.payload['TxnDate']).toBe('30/01/2024');
  });

  it('evaluates a conditional expression', async () => {
    const result = await engine.build({
      compositeJson: { status: 'active' },
      mappingRules: [
        {
          srcPath: 'status',
          destPath: 'IsActive',
          expression: "status = 'active' ? true : false",
        },
      ],
      stitchConfig: {},
    });
    expect(result.payload['IsActive']).toBe(true);
  });

  it('rounds a number with $round()', async () => {
    const result = await engine.build({
      compositeJson: { amount: 123.456 },
      mappingRules: [
        { srcPath: 'amount', destPath: 'TotalAmt', expression: '$round(amount, 2)' },
      ],
      stitchConfig: {},
    });
    expect(result.payload['TotalAmt']).toBe(123.46);
  });

  it('constructs a nested object from multiple source fields', async () => {
    const result = await engine.build({
      compositeJson: { taxId: 'TX-001', taxName: 'Sales Tax' },
      mappingRules: [
        {
          srcPath: 'taxId',
          destPath: 'TaxRef',
          expression: "{ 'value': taxId, 'name': taxName }",
        },
      ],
      stitchConfig: {},
    });
    const ref = result.payload['TaxRef'] as Record<string, unknown>;
    expect(ref['value']).toBe('TX-001');
    expect(ref['name']).toBe('Sales Tax');
  });

  it('emits a warning and skips field when expression evaluates to undefined', async () => {
    const result = await engine.build({
      compositeJson: {},
      mappingRules: [
        { srcPath: 'missingField', destPath: 'DocNumber', expression: 'nonExistentField' },
      ],
      stitchConfig: {},
    });
    expect(result.payload['DocNumber']).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('DocNumber');
  });

  it('treats an empty string expression as invalid instead of falling back to simple copy', async () => {
    const result = await engine.build({
      compositeJson: { val: 'should_not_copy' },
      mappingRules: [
        { srcPath: 'val', destPath: 'Out', expression: '' },
        { srcPath: 'val', destPath: 'Out2', expression: '   ' }
      ],
      stitchConfig: {},
    });
    expect(result.payload['Out']).toBeUndefined();
    expect(result.payload['Out2']).toBeUndefined();
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain('invalid or empty expression for destPath "Out"');
    expect(result.warnings[1]).toContain('invalid or empty expression for destPath "Out2"');
  });

  it('emits a warning and skips field when expression has a syntax error', async () => {
    // Engine cache is reset per-test via beforeEach
    const result = await engine.build({
      compositeJson: { val: 1 },
      mappingRules: [{ srcPath: 'val', destPath: 'Out', expression: '$$invalid syntax(((' }],
      stitchConfig: {},
    });
    expect(result.payload['Out']).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Out');
  });

  it('caches compiled expressions — second call uses cached version', async () => {
    const expression = '$string(amount)';
    const rule: MappingRule = { srcPath: 'amount', destPath: 'AmtStr', expression };

    // First call — compiles and caches
    await engine.build({ compositeJson: { amount: 42 }, mappingRules: [rule], stitchConfig: {} });
    // Second call — hits cache, result must be identical
    const result = await engine.build({
      compositeJson: { amount: 99 },
      mappingRules: [rule],
      stitchConfig: {},
    });
    expect(result.payload['AmtStr']).toBe('99');
  });
});

// ─── Proto-pollution Guard ────────────────────────────────────────────────────

describe('MappingEngine — security', () => {
  it('prevents proto-pollution via __proto__ in destPath — emits warning, skips field', async () => {
    const result = await engine.build({
      compositeJson: { val: 1 },
      mappingRules: [{ srcPath: 'val', destPath: '__proto__.polluted' }],
      stitchConfig: {},
    });
    // The field is NOT written — no pollution
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((Object.prototype as any)['polluted']).toBeUndefined();
    expect(result.payload['polluted']).toBeUndefined();
    // A clear warning is logged instead
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/unsafe path segment/);
  });
});

// ─── StitchConfig Behavioral Flags ───────────────────────────────────────────

describe('MappingEngine — StitchConfig behavioral flags', () => {
  it('adds TxnTaxDetail when useTaxCode is true and taxCodeDefault is set', async () => {
    const config: StitchConfig = { useTaxCode: true, taxCodeDefault: 'TAX-001' };
    const result = await engine.build({
      compositeJson: { amount: 500 },
      mappingRules: [{ srcPath: 'amount', destPath: 'TotalAmt' }],
      stitchConfig: config,
    });
    expect(result.payload['TxnTaxDetail']).toEqual({ TaxCode: 'TAX-001' });
    expect(result.warnings).toHaveLength(0);
  });

  it('does NOT add TxnTaxDetail when useTaxCode is false', async () => {
    const result = await engine.build({
      compositeJson: { amount: 500 },
      mappingRules: [{ srcPath: 'amount', destPath: 'TotalAmt' }],
      stitchConfig: { useTaxCode: false },
    });
    expect(result.payload['TxnTaxDetail']).toBeUndefined();
  });

  it('emits a warning when useTaxCode is true but taxCodeDefault is missing', async () => {
    const result = await engine.build({
      compositeJson: {},
      mappingRules: [],
      stitchConfig: { useTaxCode: true },
    });
    expect(result.payload['TxnTaxDetail']).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('taxCodeDefault');
  });

  it('applies currencyOverride to CurrencyRef.value', async () => {
    const result = await engine.build({
      compositeJson: {},
      mappingRules: [],
      stitchConfig: { currencyOverride: 'USD' },
    });
    expect((result.payload['CurrencyRef'] as Record<string, unknown>)['value']).toBe('USD');
  });

  it('keeps source object isolated from mutations applied during post-mapping configs', async () => {
    const sourceCurrency = { value: 'EUR' };
    const result = await engine.build({
      compositeJson: { originalRef: sourceCurrency },
      mappingRules: [{ srcPath: 'originalRef', destPath: 'CurrencyRef' }],
      stitchConfig: { currencyOverride: 'USD' },
    });
    // Destination is mutated
    expect((result.payload['CurrencyRef'] as Record<string, unknown>)['value']).toBe('USD');
    // Original is not
    expect(sourceCurrency.value).toBe('EUR');
  });
});

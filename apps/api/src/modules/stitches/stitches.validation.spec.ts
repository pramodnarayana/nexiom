import { describe, it, expect } from 'vitest';
import {
  CreateStitchSchema,
  UpdateStitchSchema,
} from './stitches.validation.js';

const VALID_CREATE = {
  name: 'SF Loads → QB Invoices',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  sourceDataSourceId: '22222222-2222-4222-8222-222222222222',
  destDataSourceId: '33333333-3333-4333-8333-333333333333',
  sourceObject: 'rtms__Load__c',
  targetObject: 'Invoice',
};

describe('CreateStitchSchema', () => {
  it('accepts a valid stitch with required fields only', () => {
    expect(CreateStitchSchema.safeParse(VALID_CREATE).success).toBe(true);
  });

  it('accepts all optional fields', () => {
    const result = CreateStitchSchema.safeParse({
      ...VALID_CREATE,
      syncCondition: [{ field: 'Region', op: 'eq', value: 'US' }],
      status: 'PAUSED',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty name', () => {
    expect(
      CreateStitchSchema.safeParse({ ...VALID_CREATE, name: '' }).success,
    ).toBe(false);
  });

  it('rejects a whitespace-only name', () => {
    expect(
      CreateStitchSchema.safeParse({ ...VALID_CREATE, name: '   ' }).success,
    ).toBe(false);
  });

  it('rejects a name exceeding 255 characters', () => {
    expect(
      CreateStitchSchema.safeParse({ ...VALID_CREATE, name: 'a'.repeat(256) })
        .success,
    ).toBe(false);
  });

  it('rejects missing required fields', () => {
    expect(CreateStitchSchema.safeParse({}).success).toBe(false);
    expect(CreateStitchSchema.safeParse({ name: 'test' }).success).toBe(false);
  });

  it('rejects an invalid UUID for workspaceId', () => {
    expect(
      CreateStitchSchema.safeParse({ ...VALID_CREATE, workspaceId: 'bad' })
        .success,
    ).toBe(false);
  });

  it('rejects ARCHIVED status on create', () => {
    const result = CreateStitchSchema.safeParse({
      ...VALID_CREATE,
      status: 'ARCHIVED',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.join('.') === 'status'),
      ).toBe(true);
    }
  });

  it('accepts ACTIVE and PAUSED status on create', () => {
    expect(
      CreateStitchSchema.safeParse({ ...VALID_CREATE, status: 'ACTIVE' })
        .success,
    ).toBe(true);
    expect(
      CreateStitchSchema.safeParse({ ...VALID_CREATE, status: 'PAUSED' })
        .success,
    ).toBe(true);
  });

  it('accepts a well-formed syncCondition array', () => {
    const result = CreateStitchSchema.safeParse({
      ...VALID_CREATE,
      syncCondition: [
        { field: 'Region', op: 'eq', value: 'US', logic: 'AND' },
        { field: 'Amount', op: 'gt', value: 100 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects syncCondition with an unknown op', () => {
    const result = CreateStitchSchema.safeParse({
      ...VALID_CREATE,
      syncCondition: [{ field: 'Region', op: 'startsWith', value: 'US' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.join('.').includes('op')),
      ).toBe(true);
    }
  });

  it('rejects syncCondition rule missing required field', () => {
    const result = CreateStitchSchema.safeParse({
      ...VALID_CREATE,
      syncCondition: [{ op: 'eq', value: 'US' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.join('.').includes('field')),
      ).toBe(true);
    }
  });
});

describe('UpdateStitchSchema', () => {
  it('accepts an empty object (all fields optional)', () => {
    expect(UpdateStitchSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a partial update with name only', () => {
    expect(
      UpdateStitchSchema.safeParse({ name: 'New Stitch Name' }).success,
    ).toBe(true);
  });

  it('accepts ARCHIVED status on update', () => {
    expect(UpdateStitchSchema.safeParse({ status: 'ARCHIVED' }).success).toBe(
      true,
    );
  });

  it('accepts a well-formed syncCondition update', () => {
    expect(
      UpdateStitchSchema.safeParse({
        syncCondition: [
          { field: 'Amount', op: 'gt', value: 100, logic: 'AND' },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects a syncCondition rule with an invalid op on update', () => {
    const result = UpdateStitchSchema.safeParse({
      syncCondition: [{ field: 'Amount', op: 'between', value: 100 }],
    });
    expect(result.success).toBe(false);
  });
});

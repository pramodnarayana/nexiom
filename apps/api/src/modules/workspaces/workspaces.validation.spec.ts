import { describe, it, expect } from 'vitest';
import {
  CreateWorkspaceSchema,
  UpdateWorkspaceSchema,
} from './workspaces.validation.js';

describe('CreateWorkspaceSchema', () => {
  it('accepts a valid name', () => {
    expect(
      CreateWorkspaceSchema.safeParse({ name: 'Logistics-US' }).success,
    ).toBe(true);
  });

  it('accepts an optional envType', () => {
    expect(
      CreateWorkspaceSchema.safeParse({ name: 'Logistics', envType: 'SANDBOX' })
        .success,
    ).toBe(true);
  });

  it('defaults envType to undefined when omitted', () => {
    const result = CreateWorkspaceSchema.safeParse({ name: 'Logistics' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.envType).toBeUndefined();
  });

  it('rejects an empty name', () => {
    expect(CreateWorkspaceSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('rejects a whitespace-only name', () => {
    expect(CreateWorkspaceSchema.safeParse({ name: '   ' }).success).toBe(
      false,
    );
  });

  it('accepts a name of exactly 255 characters', () => {
    expect(
      CreateWorkspaceSchema.safeParse({ name: 'a'.repeat(255) }).success,
    ).toBe(true);
  });

  it('rejects a name exceeding 255 characters', () => {
    expect(
      CreateWorkspaceSchema.safeParse({ name: 'a'.repeat(256) }).success,
    ).toBe(false);
  });

  it('rejects a missing name', () => {
    expect(CreateWorkspaceSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an invalid envType', () => {
    expect(
      CreateWorkspaceSchema.safeParse({ name: 'Logistics', envType: 'DEV' })
        .success,
    ).toBe(false);
  });
});

describe('UpdateWorkspaceSchema', () => {
  it('accepts an empty object (all fields optional)', () => {
    expect(UpdateWorkspaceSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a partial update with name only', () => {
    expect(UpdateWorkspaceSchema.safeParse({ name: 'New Name' }).success).toBe(
      true,
    );
  });

  it('accepts a partial update with envType only', () => {
    expect(
      UpdateWorkspaceSchema.safeParse({ envType: 'PRODUCTION' }).success,
    ).toBe(true);
  });

  it('rejects an empty name string', () => {
    expect(UpdateWorkspaceSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('rejects a whitespace-only name', () => {
    expect(UpdateWorkspaceSchema.safeParse({ name: '   ' }).success).toBe(
      false,
    );
  });

  it('rejects an invalid envType', () => {
    expect(UpdateWorkspaceSchema.safeParse({ envType: 'DEV' }).success).toBe(
      false,
    );
  });
});

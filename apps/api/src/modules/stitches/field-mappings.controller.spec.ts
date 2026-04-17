import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard, PermissionsGuard } from '@nexiom/auth';
import { FieldMappingsController } from './field-mappings.controller.js';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { ORG_ID, makeAuth } from '../workspaces/workspace-test-fixtures.js';
import {
  UpsertFieldMappingSchema,
  UpsertFieldMappingBody,
  BulkUpsertAndDeleteBody,
} from './field-mappings.validation.js';

const STITCH_ID = 'stitch-uuid-1';
const MAPPING_BODY: UpsertFieldMappingBody = {
  sourceCanonical: 'TMS_INVOICE',
  mappingRules: [{ src: '$.rtms__Total_Amount__c', dest: '$.TotalAmt' }],
};

function buildMockDb() {
  const findFirstStitch = vi.fn();
  const returning = vi.fn();
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });

  const where = vi.fn().mockReturnValue({ returning });
  const dbDelete = vi.fn().mockReturnValue({ where });

  const transaction = vi
    .fn()
    .mockImplementation((cb: (arg: unknown) => unknown) =>
      cb({
        insert,
        delete: dbDelete,
      } as any),
    );

  return {
    findFirstStitch,
    insert,
    values,
    onConflictDoUpdate,
    returning,
    delete: dbDelete,
    where,
    transaction,
    db: {
      query: {
        integrationStitches: { findFirst: findFirstStitch },
      },
      insert,
      delete: dbDelete,
      transaction,
    },
  };
}

describe('FieldMappingsController', () => {
  let controller: FieldMappingsController;
  let mocks: ReturnType<typeof buildMockDb>;

  beforeEach(async () => {
    mocks = buildMockDb();

    const module = await Test.createTestingModule({
      controllers: [FieldMappingsController],
      providers: [{ provide: DATABASE_CONNECTION, useValue: mocks.db }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(FieldMappingsController);
    vi.clearAllMocks();
  });

  const STITCH_ROW = { id: STITCH_ID, orgId: ORG_ID, name: 'Test Stitch' };
  const MAPPING_ROW = {
    id: 'mapping-uuid-1',
    stitchId: STITCH_ID,
    sourceCanonical: MAPPING_BODY.sourceCanonical,
    mappingRules: MAPPING_BODY.mappingRules,
  };

  // ── upsert (POST) ───────────────────────────────────────────────────────────

  it('upsert — executes full upsert chain and returns the mapping row', async () => {
    mocks.findFirstStitch.mockResolvedValue(STITCH_ROW);
    mocks.returning.mockResolvedValue([MAPPING_ROW]);

    const result = await controller.upsert(makeAuth(), STITCH_ID, MAPPING_BODY);

    expect(result).toBe(MAPPING_ROW);

    // findFirst called with a tenant-scoped where clause
    expect(mocks.findFirstStitch).toHaveBeenCalledOnce();
    expect(mocks.findFirstStitch).toHaveBeenCalledWith(
      expect.objectContaining<{ where: unknown }>({
        where: expect.anything() as unknown,
      }),
    );

    // insert() called with the fieldMappings table
    expect(mocks.insert).toHaveBeenCalledOnce();

    // values() called with the correct payload
    expect(mocks.values).toHaveBeenCalledOnce();
    expect(mocks.values).toHaveBeenCalledWith({
      stitchId: STITCH_ID,
      sourceCanonical: MAPPING_BODY.sourceCanonical,
      mappingRules: MAPPING_BODY.mappingRules,
    });

    // onConflictDoUpdate() called — upsert path, not plain insert
    expect(mocks.onConflictDoUpdate).toHaveBeenCalledOnce();
    const call = mocks.onConflictDoUpdate.mock.calls[0];
    expect(call).toBeDefined();
    const [conflictArg] = call as [
      { target: unknown[]; set: { mappingRules: unknown; updatedAt: unknown } },
    ];
    expect(conflictArg.set.mappingRules).toEqual(MAPPING_BODY.mappingRules);

    // target must be a two-column array (stitchId + sourceCanonical) — the upsert key set
    expect(Array.isArray(conflictArg.target)).toBe(true);
    expect(conflictArg.target).toHaveLength(2);

    // returning() called to get the persisted row
    expect(mocks.returning).toHaveBeenCalledOnce();
  });

  it('upsert — throws NotFoundException when stitch not in org', async () => {
    mocks.findFirstStitch.mockResolvedValue(null);

    await expect(
      controller.upsert(makeAuth(), STITCH_ID, MAPPING_BODY),
    ).rejects.toThrow(NotFoundException);

    expect(mocks.insert).not.toHaveBeenCalled();
  });

  // ── update (PATCH) ──────────────────────────────────────────────────────────

  it('update — performs the same upsert as POST', async () => {
    mocks.findFirstStitch.mockResolvedValue(STITCH_ROW);
    mocks.returning.mockResolvedValue([MAPPING_ROW]);

    const result = await controller.update(makeAuth(), STITCH_ID, MAPPING_BODY);
    expect(result).toBe(MAPPING_ROW);

    expect(mocks.findFirstStitch).toHaveBeenCalled();

    expect(mocks.values).toHaveBeenCalledWith({
      stitchId: STITCH_ID,
      sourceCanonical: MAPPING_BODY.sourceCanonical,
      mappingRules: MAPPING_BODY.mappingRules,
    });

    expect(mocks.returning).toHaveBeenCalled();
  });
  // ── remove (DELETE) ────────────────────────────────────────────────────────

  it('remove — deletes field mappings for sourceCanonical', async () => {
    mocks.findFirstStitch.mockResolvedValue(STITCH_ROW);

    await controller.remove(makeAuth(), STITCH_ID, 'TMS_INVOICE');

    expect(mocks.findFirstStitch).toHaveBeenCalledOnce();
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(mocks.where).toHaveBeenCalledOnce();
  });

  it('remove — throws NotFoundException when stitch not found', async () => {
    mocks.findFirstStitch.mockResolvedValue(null);

    await expect(
      controller.remove(makeAuth(), STITCH_ID, 'TMS_INVOICE'),
    ).rejects.toThrow(NotFoundException);

    expect(mocks.delete).not.toHaveBeenCalled();
  });

  // ── bulkUpsertAndDelete (POST bulk) ───────────────────────────────────────

  it('bulkUpsertAndDelete — executes ops in transaction', async () => {
    mocks.findFirstStitch.mockResolvedValue(STITCH_ROW);
    mocks.returning.mockResolvedValue([{ id: 'upserted-id' }]);

    const body: BulkUpsertAndDeleteBody = {
      toDelete: ['TMS_INVOICE'],
      toUpsert: [{ sourceCanonical: 'TMS_BILL', mappingRules: [] }],
    };

    const result = await controller.bulkUpsertAndDelete(
      makeAuth(),
      STITCH_ID,
      body,
    );

    expect(result).toEqual([{ id: 'upserted-id' }]);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(mocks.insert).toHaveBeenCalledOnce();
  });

  it('bulkUpsertAndDelete — throws NotFoundException if stitch missing', async () => {
    mocks.findFirstStitch.mockResolvedValue(null);

    const body: BulkUpsertAndDeleteBody = { toDelete: [], toUpsert: [] };

    await expect(
      controller.bulkUpsertAndDelete(makeAuth(), STITCH_ID, body),
    ).rejects.toThrow(NotFoundException);

    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

// ── UpsertFieldMappingSchema unit tests ──────────────────────────────────────
// Controller tests use `as any` to bypass NestJS pipes, so schema acceptance
// must be validated directly against the Zod schema.

describe('UpsertFieldMappingSchema', () => {
  it('accepts a well-formed payload with mapping rules', () => {
    expect(() =>
      UpsertFieldMappingSchema.parse({
        sourceCanonical: 'TMS_INVOICE',
        mappingRules: [{ src: '$.Amount', dest: '$.TotalAmt' }],
      }),
    ).not.toThrow();
  });

  it('accepts empty mappingRules [] — signals clear-all-mappings semantics', () => {
    expect(() =>
      UpsertFieldMappingSchema.parse({
        sourceCanonical: 'TMS_INVOICE',
        mappingRules: [],
      }),
    ).not.toThrow();
  });

  it('accepts an optional transform on a mapping rule', () => {
    expect(() =>
      UpsertFieldMappingSchema.parse({
        sourceCanonical: 'TMS_INVOICE',
        mappingRules: [
          { src: '$.Amount', dest: '$.TotalAmt', transform: 'toNumber' },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects a whitespace-only transform value', () => {
    expect(() =>
      UpsertFieldMappingSchema.parse({
        sourceCanonical: 'TMS_INVOICE',
        mappingRules: [
          { src: '$.Amount', dest: '$.TotalAmt', transform: '   ' },
        ],
      }),
    ).toThrow();
  });

  it('rejects an empty string transform value', () => {
    expect(() =>
      UpsertFieldMappingSchema.parse({
        sourceCanonical: 'TMS_INVOICE',
        mappingRules: [{ src: '$.Amount', dest: '$.TotalAmt', transform: '' }],
      }),
    ).toThrow();
  });

  it('rejects sourceCanonical longer than 100 characters', () => {
    expect(() =>
      UpsertFieldMappingSchema.parse({
        sourceCanonical: 'x'.repeat(101),
        mappingRules: [],
      }),
    ).toThrow();
  });

  it('rejects more than 200 mapping rules', () => {
    expect(() =>
      UpsertFieldMappingSchema.parse({
        sourceCanonical: 'X',
        mappingRules: Array.from({ length: 201 }, (_, i) => ({
          src: `$.f${i}`,
          dest: `$.g${i}`,
        })),
      }),
    ).toThrow();
  });
});

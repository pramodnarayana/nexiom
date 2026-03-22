import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard, PermissionsGuard } from '@nexiom/auth';
import { FieldMappingsController } from './field-mappings.controller.js';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { ORG_ID, makeAuth } from '../workspaces/workspace-test-fixtures.js';

const STITCH_ID = 'stitch-uuid-1';
const MAPPING_BODY = {
  sourceCanonical: 'TMS_INVOICE',
  mappingRules: [{ src: '$.rtms__Total_Amount__c', dest: '$.TotalAmt' }],
};

function buildMockDb() {
  const findFirstStitch = vi.fn();
  const returning = vi.fn();
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });

  return {
    findFirstStitch,
    returning,
    db: {
      query: {
        integrationStitches: { findFirst: findFirstStitch },
      },
      insert,
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

  it('upsert — inserts and returns the mapping', async () => {
    mocks.findFirstStitch.mockResolvedValue(STITCH_ROW);
    mocks.returning.mockResolvedValue([MAPPING_ROW]);

    const result = await controller.upsert(
      makeAuth(),
      STITCH_ID,
      MAPPING_BODY as any,
    );
    expect(result).toBe(MAPPING_ROW);
    expect(mocks.db.insert).toHaveBeenCalled();
  });

  it('upsert — throws NotFoundException when stitch not in org', async () => {
    mocks.findFirstStitch.mockResolvedValue(null);

    await expect(
      controller.upsert(makeAuth(), STITCH_ID, MAPPING_BODY as any),
    ).rejects.toThrow(NotFoundException);
  });

  // ── update (PATCH) ──────────────────────────────────────────────────────────

  it('update — performs the same upsert as POST', async () => {
    mocks.findFirstStitch.mockResolvedValue(STITCH_ROW);
    mocks.returning.mockResolvedValue([MAPPING_ROW]);

    const result = await controller.update(
      makeAuth(),
      STITCH_ID,
      MAPPING_BODY as any,
    );
    expect(result).toBe(MAPPING_ROW);
  });

  it('upsert — accepts empty mappingRules and clears all mappings', async () => {
    const emptyRulesRow = { ...MAPPING_ROW, mappingRules: [] };
    mocks.findFirstStitch.mockResolvedValue(STITCH_ROW);
    mocks.returning.mockResolvedValue([emptyRulesRow]);

    const result = await controller.upsert(makeAuth(), STITCH_ID, {
      sourceCanonical: MAPPING_BODY.sourceCanonical,
      mappingRules: [],
    } as any);
    expect(result).toBe(emptyRulesRow);
    expect(mocks.db.insert).toHaveBeenCalled();
  });
});

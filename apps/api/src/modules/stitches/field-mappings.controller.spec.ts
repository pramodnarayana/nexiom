import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard, PermissionsGuard } from '@soopa/auth';
import { FieldMappingsController } from './field-mappings.controller.js';
import { FieldMappingsRepository } from './repositories/field-mappings.repository.js';
import { ORG_ID, makeAuth } from '../workspaces/workspace-test-fixtures.js';
import type {
  UpsertFieldMappingBody,
  BulkUpsertAndDeleteBody,
} from './field-mappings.validation.js';

const STITCH_ID = 'stitch-uuid-1';

const MAPPING_BODY: UpsertFieldMappingBody = {
  sourceCanonical: 'TMS_INVOICE',
  mappingRules: [{ src: '$.rtms__Total_Amount__c', dest: '$.TotalAmt' }],
};

const MAPPING_ROW = {
  id: 'mapping-uuid-1',
  stitchId: STITCH_ID,
  sourceCanonical: MAPPING_BODY.sourceCanonical,
  mappingRules: MAPPING_BODY.mappingRules,
};

describe('FieldMappingsController', () => {
  let controller: FieldMappingsController;
  let repo: {
    upsertMapping: ReturnType<typeof vi.fn>;
    deleteMapping: ReturnType<typeof vi.fn>;
    bulkUpsertAndDelete: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    repo = {
      upsertMapping: vi.fn().mockResolvedValue(MAPPING_ROW),
      deleteMapping: vi.fn().mockResolvedValue(undefined),
      bulkUpsertAndDelete: vi.fn().mockResolvedValue([MAPPING_ROW]),
    };

    const module = await Test.createTestingModule({
      controllers: [FieldMappingsController],
      providers: [{ provide: FieldMappingsRepository, useValue: repo }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(FieldMappingsController);
  });

  // ── upsert (POST) ──────────────────────────────────────────────────────────

  it('upsert — delegates to repository.upsertMapping and returns result', async () => {
    const result = await controller.upsert(makeAuth(), STITCH_ID, MAPPING_BODY);

    expect(result).toBe(MAPPING_ROW);
    expect(repo.upsertMapping).toHaveBeenCalledWith(
      ORG_ID,
      STITCH_ID,
      MAPPING_BODY,
    );
  });

  it('upsert — propagates NotFoundException from repository', async () => {
    repo.upsertMapping.mockRejectedValueOnce(
      new NotFoundException('Stitch not found'),
    );

    await expect(
      controller.upsert(makeAuth(), STITCH_ID, MAPPING_BODY),
    ).rejects.toThrow(NotFoundException);
  });

  // ── update (PATCH) ─────────────────────────────────────────────────────────

  it('update — delegates to repository.upsertMapping (same as POST)', async () => {
    const result = await controller.update(makeAuth(), STITCH_ID, MAPPING_BODY);

    expect(result).toBe(MAPPING_ROW);
    expect(repo.upsertMapping).toHaveBeenCalledWith(
      ORG_ID,
      STITCH_ID,
      MAPPING_BODY,
    );
  });

  // ── remove (DELETE) ────────────────────────────────────────────────────────

  it('remove — delegates to repository.deleteMapping', async () => {
    await expect(
      controller.remove(makeAuth(), STITCH_ID, 'TMS_INVOICE'),
    ).resolves.toBeUndefined();

    expect(repo.deleteMapping).toHaveBeenCalledWith(
      ORG_ID,
      STITCH_ID,
      'TMS_INVOICE',
    );
  });

  it('remove — propagates NotFoundException from repository', async () => {
    repo.deleteMapping.mockRejectedValueOnce(
      new NotFoundException('Stitch not found'),
    );

    await expect(
      controller.remove(makeAuth(), STITCH_ID, 'TMS_INVOICE'),
    ).rejects.toThrow(NotFoundException);
  });

  // ── bulkUpsertAndDelete (POST /bulk) ───────────────────────────────────────

  it('bulkUpsertAndDelete — delegates to repository and returns results', async () => {
    const body: BulkUpsertAndDeleteBody = {
      toDelete: ['TMS_INVOICE'],
      toUpsert: [{ sourceCanonical: 'TMS_BILL', mappingRules: [] }],
    };

    const result = await controller.bulkUpsertAndDelete(
      makeAuth(),
      STITCH_ID,
      body,
    );

    expect(result).toEqual([MAPPING_ROW]);
    expect(repo.bulkUpsertAndDelete).toHaveBeenCalledWith(
      ORG_ID,
      STITCH_ID,
      body,
    );
  });

  it('bulkUpsertAndDelete — propagates NotFoundException when stitch not in org', async () => {
    repo.bulkUpsertAndDelete.mockRejectedValueOnce(
      new NotFoundException('Stitch not found'),
    );

    const body: BulkUpsertAndDeleteBody = { toDelete: [], toUpsert: [] };

    await expect(
      controller.bulkUpsertAndDelete(makeAuth(), STITCH_ID, body),
    ).rejects.toThrow(NotFoundException);
  });
});

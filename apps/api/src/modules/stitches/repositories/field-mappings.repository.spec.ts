import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { FieldMappingsRepository } from './field-mappings.repository.js';
import type {
  UpsertFieldMappingBody,
  BulkUpsertAndDeleteBody,
} from '../field-mappings.validation.js';

const STITCH_ID = 'stitch-uuid-1';
const ORG_ID = 'org-uuid-1';

function createMockDb() {
  const findFirstStitch = vi.fn();
  const returning = vi.fn();
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });

  const where = vi.fn().mockReturnValue({ returning });
  const dbDelete = vi.fn().mockReturnValue({ where });
  const transaction = vi.fn();

  return {
    findFirstStitch,
    insert,
    values,
    onConflictDoUpdate,
    returning,
    delete: dbDelete,
    where,
    transaction,
    query: {
      integrationStitches: { findFirst: findFirstStitch },
    },
  };
}

describe('FieldMappingsRepository', () => {
  let repo: FieldMappingsRepository;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockSavepointManager: any;

  beforeEach(() => {
    mockDb = createMockDb();
    mockSavepointManager = {
      createSavepoint: vi.fn(),
      releaseSavepoint: vi.fn(),
      rollbackToSavepoint: vi.fn(),
    };

    // We can mock transaction directly on the DB for the BaseRepository to use
    (mockDb as any).transaction = vi.fn().mockImplementation(async (cb) => {
      return await cb(mockDb);
    });

    repo = new FieldMappingsRepository(mockDb as any, mockSavepointManager);
  });

  const MAPPING_BODY: UpsertFieldMappingBody = {
    sourceCanonical: 'TMS_INVOICE',
    mappingRules: [{ src: '$.Amount', dest: '$.TotalAmt' }],
  };

  const STITCH_ROW = { id: STITCH_ID, orgId: ORG_ID };

  // ── findStitchForOrg ───────────────────────────────────────────────────────

  describe('findStitchForOrg', () => {
    it('returns stitch when found', async () => {
      mockDb.findFirstStitch.mockResolvedValue(STITCH_ROW);

      const result = await repo.findStitchForOrg(STITCH_ID, ORG_ID);
      expect(result).toBe(STITCH_ROW);
      expect(mockDb.findFirstStitch).toHaveBeenCalledOnce();
    });

    it('returns null when not found', async () => {
      mockDb.findFirstStitch.mockResolvedValue(undefined);

      const result = await repo.findStitchForOrg(STITCH_ID, ORG_ID);
      expect(result).toBeNull();
    });
  });

  // ── upsertMapping ──────────────────────────────────────────────────────────

  describe('upsertMapping', () => {
    it('inserts and returns mapping on success', async () => {
      mockDb.findFirstStitch.mockResolvedValue(STITCH_ROW);
      const row = { id: 'm1' };
      mockDb.returning.mockResolvedValue([row]);

      const result = await repo.upsertMapping(ORG_ID, STITCH_ID, MAPPING_BODY);

      expect(result).toBe(row);
      expect(mockDb.insert).toHaveBeenCalledOnce();
      expect(mockDb.values).toHaveBeenCalledWith({
        stitchId: STITCH_ID,
        sourceCanonical: MAPPING_BODY.sourceCanonical,
        mappingRules: MAPPING_BODY.mappingRules,
      });
      expect(mockDb.onConflictDoUpdate).toHaveBeenCalledOnce();
    });

    it('throws NotFoundException if stitch does not belong to org', async () => {
      mockDb.findFirstStitch.mockResolvedValue(null);

      await expect(
        repo.upsertMapping(ORG_ID, STITCH_ID, MAPPING_BODY),
      ).rejects.toThrow(NotFoundException);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  // ── deleteMapping ──────────────────────────────────────────────────────────

  describe('deleteMapping', () => {
    it('deletes mapping successfully', async () => {
      mockDb.findFirstStitch.mockResolvedValue(STITCH_ROW);

      await repo.deleteMapping(ORG_ID, STITCH_ID, 'TMS_INVOICE');

      expect(mockDb.delete).toHaveBeenCalledOnce();
      expect(mockDb.where).toHaveBeenCalledOnce();
    });

    it('throws NotFoundException if stitch does not belong to org', async () => {
      mockDb.findFirstStitch.mockResolvedValue(null);

      await expect(
        repo.deleteMapping(ORG_ID, STITCH_ID, 'TMS_INVOICE'),
      ).rejects.toThrow(NotFoundException);
      expect(mockDb.delete).not.toHaveBeenCalled();
    });
  });

  // ── bulkUpsertAndDelete ────────────────────────────────────────────────────

  describe('bulkUpsertAndDelete', () => {
    it('executes ops in transaction and returns results', async () => {
      mockDb.findFirstStitch.mockResolvedValue(STITCH_ROW);
      const row = { id: 'm1' };
      mockDb.returning.mockResolvedValue([row]);

      const body: BulkUpsertAndDeleteBody = {
        toDelete: ['TMS_INVOICE'],
        toUpsert: [{ sourceCanonical: 'TMS_BILL', mappingRules: [] }],
      };

      const result = await repo.bulkUpsertAndDelete(ORG_ID, STITCH_ID, body);

      expect(result).toEqual([row]);
      expect(mockDb.transaction).toHaveBeenCalledOnce();
      expect(mockDb.delete).toHaveBeenCalledOnce();
      expect(mockDb.insert).toHaveBeenCalledOnce();
    });

    it('throws NotFoundException if stitch does not belong to org', async () => {
      mockDb.findFirstStitch.mockResolvedValue(null);

      const body: BulkUpsertAndDeleteBody = { toDelete: [], toUpsert: [] };

      await expect(
        repo.bulkUpsertAndDelete(ORG_ID, STITCH_ID, body),
      ).rejects.toThrow(NotFoundException);
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });
  });
});

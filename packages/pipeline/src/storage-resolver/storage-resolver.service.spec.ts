import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { StorageResolverService } from '../index.js';
import { DATABASE_CONNECTION } from '@soopa/database';

// ── DB mock helpers ──────────────────────────────────────────────────────────

type SelectResult = Array<{ schemaName: string | null; tenantId?: string | null }>;

function buildDbMock(result: SelectResult) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(result),
        }),
      }),
    }),
  };
}

async function buildService(dbMock: ReturnType<typeof buildDbMock>) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      StorageResolverService,
      { provide: DATABASE_CONNECTION, useValue: dbMock },
    ],
  }).compile();
  return module.get<StorageResolverService>(StorageResolverService);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('StorageResolverService', () => {
  describe('resolveSchemaName', () => {
    it('should return the stored schemaName directly from the database', async () => {
      const db = buildDbMock([{ schemaName: 'ws_salesforce_34ad40d48e92676d', tenantId: 'tenant-123' }]);
      const service = await buildService(db);

      const result = await service.resolveSchemaName('2395444f-489a-4ab7-a45f-ca49f171d0a1');

      expect(result).toBe('ws_salesforce_34ad40d48e92676d');
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it('should serve subsequent calls from the LRU cache without hitting the DB again', async () => {
      const db = buildDbMock([{ schemaName: 'ws_salesforce_34ad40d48e92676d', tenantId: 'tenant-123' }]);
      const service = await buildService(db);
      const dataSourceId = '2395444f-489a-4ab7-a45f-ca49f171d0a1';

      // First call — DB hit
      const first = await service.resolveSchemaName(dataSourceId);
      // Second call — should be served from cache
      const second = await service.resolveSchemaName(dataSourceId);

      expect(first).toBe(second);
      // DB must have been called exactly once — cache served the second call
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it('should throw NotFoundException when connection does not exist', async () => {
      const db = buildDbMock([]);
      const service = await buildService(db);

      await expect(service.resolveSchemaName('non-existent-uuid')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when schemaName is null (pre-migration row)', async () => {
      const db = buildDbMock([{ schemaName: null, tenantId: 'tenant-123' }]);
      const service = await buildService(db);

      await expect(
        service.resolveSchemaName('2395444f-489a-4ab7-a45f-ca49f171d0a1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw for an empty dataSourceId without hitting the DB', async () => {
      const db = buildDbMock([{ schemaName: 'ws_salesforce_34ad40d48e92676d', tenantId: 'tenant-123' }]);
      const service = await buildService(db);

      await expect(service.resolveSchemaName('')).rejects.toThrow(
        /dataSourceId must be a non-empty string/,
      );
      expect(db.select).not.toHaveBeenCalled();
    });

    it('should resolve different connections independently', async () => {
      const sfSchemaName = 'ws_salesforce_34ad40d48e92676d';
      const qbSchemaName = 'ws_quickbooks_abcdef1234567890';
      let callCount = 0;

      const db = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockImplementation(() => {
                callCount++;
                // Alternate between two schemas to simulate different connections
                return Promise.resolve([
                  { schemaName: callCount === 1 ? sfSchemaName : qbSchemaName, tenantId: 'tenant-123' },
                ]);
              }),
            }),
          }),
        })),
      };

      const service = await buildService(db as ReturnType<typeof buildDbMock>);

      const sf = await service.resolveSchemaName('salesforce-conn-id');
      const qb = await service.resolveSchemaName('quickbooks-conn-id');

      expect(sf).toBe(sfSchemaName);
      expect(qb).toBe(qbSchemaName);
      // Each connection required exactly one DB call
      expect(db.select).toHaveBeenCalledTimes(2);
    });
  });

  describe('getHostContext', () => {
    it('should throw when tenant-per-database logic is not yet implemented', async () => {
      const db = buildDbMock([{ schemaName: 'ws_salesforce_34ad40d48e92676d', tenantId: 'tenant-123' }]);
      const service = await buildService(db);

      await expect(service.getHostContext('conn-123')).rejects.toThrow(
        /getHostContext not yet implemented/,
      );
    });
  });
});
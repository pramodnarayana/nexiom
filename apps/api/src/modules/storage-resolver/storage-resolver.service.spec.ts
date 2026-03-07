import { Test, TestingModule } from '@nestjs/testing';
import { StorageResolverService } from './storage-resolver.service.js';
import {
  DATABASE_CONNECTION,
  connectionStorageRegistry,
} from '@nexiom/database';
import { NotFoundException } from '@nestjs/common';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('StorageResolverService', () => {
  let service: StorageResolverService;

  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageResolverService,
        {
          provide: DATABASE_CONNECTION,
          useValue: mockDb,
        },
      ],
    }).compile();

    service = module.get<StorageResolverService>(StorageResolverService);
  });

  describe('resolveSchemaName', () => {
    it('should return the workspaceId for a valid connectionId', async () => {
      mockDb.limit.mockResolvedValue([{ workspaceId: 'ws_salesforce_123' }]);

      const result = await service.resolveSchemaName('conn-123');
      expect(result).toBe('ws_salesforce_123');
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalledWith(connectionStorageRegistry);
    });

    it('should throw NotFoundException if connection has no workspace mapped', async () => {
      mockDb.limit.mockResolvedValue([]);

      await expect(service.resolveSchemaName('conn-unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getHostContext', () => {
    it('should return the full host and region mapping', async () => {
      const mockEntry = {
        connectionId: 'conn-123',
        workspaceId: 'ws_salesforce_123',
        databaseHostId: 'primary-cluster',
        regionContext: 'eu-central-1',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      };
      mockDb.limit.mockResolvedValue([mockEntry]);

      const result = await service.getHostContext('conn-123');
      expect(result).toEqual(mockEntry);
    });

    it('should throw NotFoundException if connection has no tracking row', async () => {
      mockDb.limit.mockResolvedValue([]);

      await expect(service.getHostContext('conn-unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { StorageResolverService } from '../index.js';

describe('StorageResolverService', () => {
  let service: StorageResolverService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [StorageResolverService],
    }).compile();

    service = module.get<StorageResolverService>(StorageResolverService);
  });

  describe('resolveSchemaName', () => {
    it('should return the deterministic schemaName for a valid connectionId', async () => {
      const result = await service.resolveSchemaName('conn-123');
      expect(result).toBe('ws_conn_123');
    });
  });

  describe('getHostContext', () => {
    it('should throw when tenant-per-database logic is not yet implemented', async () => {
      await expect(service.getHostContext('conn-123')).rejects.toThrow(
        /getHostContext not yet implemented/
      );
      await expect(service.getHostContext('conn-123')).rejects.toThrow(
        /conn-123/
      );
    });
  });
});
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
    it('should return a local stub for now', async () => {
      const result = await service.getHostContext('conn-123');
      expect(result).toHaveProperty('regionContext', 'local');
      expect(result).toHaveProperty('databaseHostUrl');
    });
  });
});
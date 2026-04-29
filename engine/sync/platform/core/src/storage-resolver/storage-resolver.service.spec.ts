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

    it('should lowercase uppercase inputs', async () => {
      const result = await service.resolveSchemaName('CONN-ABC');
      expect(result).toBe('ws_conn_abc');
    });

    it('should replace invalid characters with underscores', async () => {
      const result = await service.resolveSchemaName('conn@123#test!');
      expect(result).toBe('ws_conn_123_test_');
    });

    it('should prefix with underscore if input starts with a digit', async () => {
      const result = await service.resolveSchemaName('123-conn');
      expect(result).toBe('ws__123_conn');
    });

    it('should truncate inputs longer than 63 characters', async () => {
      const longInput = 'a'.repeat(100);
      const result = await service.resolveSchemaName(longInput);
      // "ws_" is 3 chars, so max sanitized length is 60
      expect(result).toBe('ws_' + 'a'.repeat(60));
    });

    it('should handle mixed-case with special characters and ensure normalization', async () => {
      const result = await service.resolveSchemaName('SalesForce-API');
      expect(result).toBe('ws_salesforce_api');
    });

    it('should handle input that becomes empty after sanitization by throwing', async () => {
      await expect(service.resolveSchemaName('')).rejects.toThrow(
        /Cannot derive valid schema name/,
      );
    });

    it('should preserve underscores in the input', async () => {
      const result = await service.resolveSchemaName('conn_test_123');
      expect(result).toBe('ws_conn_test_123');
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
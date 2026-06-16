import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DrizzlePieceRepository } from './drizzle-piece.repository.js';
import { pieces } from '@soopa/database';

describe('DrizzlePieceRepository', () => {
  let repository: DrizzlePieceRepository;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    };

    repository = new DrizzlePieceRepository(mockDb);
  });

  it('should insert or update a piece', async () => {
    await repository.upsertPiece({
      name: 'test-piece',
      displayName: 'Test Piece',
      packageName: '@soopa/test',
      version: '1.0.0',
      logoUrl: 'http://logo',
    });

    expect(mockDb.insert).toHaveBeenCalledWith(pieces);
    expect(mockDb.values).toHaveBeenCalledWith(expect.objectContaining({
      name: 'test-piece',
      displayName: 'Test Piece',
      packageName: '@soopa/test',
      version: '1.0.0',
      logoUrl: 'http://logo',
      enabled: true,
    }));
    expect(mockDb.onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({
      target: pieces.name,
    }));
  });

  it('should handle undefined logoUrl', async () => {
    await repository.upsertPiece({
      name: 'test-piece',
      displayName: 'Test Piece',
      packageName: '@soopa/test',
      version: '1.0.0',
    });

    expect(mockDb.values).toHaveBeenCalledWith(expect.objectContaining({
      logoUrl: '',
    }));
  });
});

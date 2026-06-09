import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { PieceLoaderService } from './piece-loader.service.js';
import type { IPieceResolver } from './piece-resolver.port.js';
import type { DrizzleDb } from '@soopa/database';

/** Minimal valid Piece shape that satisfies isPiece(). */
const makeValidPiece = (name: string) => ({
  name,
  displayName: 'Test Piece',
  description: 'desc',
  logoUrl: 'url',
  actions: {},
  triggers: {},
  auth: {},
  categories: [],
});

describe('PieceLoaderService', () => {
  let service: PieceLoaderService;
  let resolver: Mocked<IPieceResolver>;
  let mockDb: Mocked<DrizzleDb>;

  beforeEach(() => {
    resolver = {
      resolve: vi.fn(),
    } as Mocked<IPieceResolver>;

    const mockSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { name: 'slack', packageName: '@soopa/piece-slack', enabled: true },
      ]),
    };

    mockDb = {
      select: vi.fn().mockReturnValue(mockSelect),
    } as unknown as Mocked<DrizzleDb>;

    service = new PieceLoaderService(resolver);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Success path ──────────────────────────────────────────────────────────

  it('should successfully load a piece when the resolver returns a valid module', async () => {
    resolver.resolve.mockResolvedValueOnce({
      slackPiece: makeValidPiece('slack'),
    });

    const result = await service.loadEnabledPieces(mockDb);

    expect(resolver.resolve).toHaveBeenCalledWith('@soopa/piece-slack');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('slack');
  });

  // ── Failure surface (no silent errors) ───────────────────────────────────

  it('should log the error and skip the piece when the resolver throws — app continues', async () => {
    resolver.resolve.mockRejectedValueOnce(new Error('NPM registry unreachable'));

    const result = await service.loadEnabledPieces(mockDb);

    // Error is surfaced: resolver was called (not silently bypassed).
    expect(resolver.resolve).toHaveBeenCalledWith('@soopa/piece-slack');
    // App continues: other pieces would load; this one returns empty.
    expect(result).toHaveLength(0);
  });

  it('should include a descriptive message when the resolver throws a non-Error rejection', async () => {
    // Validates that unknown rejection types (strings, objects) are safely narrowed.
    resolver.resolve.mockRejectedValueOnce('network timeout');

    const result = await service.loadEnabledPieces(mockDb);

    expect(result).toHaveLength(0);
  });

  // ── Name-mismatch guard ───────────────────────────────────────────────────

  it('should skip a piece whose exported name does not match the DB-registered name', async () => {
    resolver.resolve.mockResolvedValueOnce({
      slackPiece: makeValidPiece('wrong-name'),
    });

    const result = await service.loadEnabledPieces(mockDb);
    expect(result).toHaveLength(0);
  });

  // ── No valid export ───────────────────────────────────────────────────────

  it('should skip and warn when the module exports nothing with a valid Piece shape', async () => {
    resolver.resolve.mockResolvedValueOnce({
      someExport: { name: 'slack', description: 'desc' }, // missing required fields
    });

    const result = await service.loadEnabledPieces(mockDb);
    expect(result).toHaveLength(0);
  });

  // ── Multiple pieces, partial failure ─────────────────────────────────────

  it('should load successful pieces and skip failed ones when multiple pieces are queried', async () => {
    // Override mockDb to return two pieces
    const multiSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { name: 'slack', packageName: '@soopa/piece-slack', enabled: true },
        { name: 'hubspot', packageName: '@soopa/piece-hubspot', enabled: true },
      ]),
    };
    (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue(multiSelect);

    resolver.resolve
      .mockResolvedValueOnce({ slackPiece: makeValidPiece('slack') })
      .mockRejectedValueOnce(new Error('404 Not Found'));

    const result = await service.loadEnabledPieces(mockDb);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('slack');
  });
});

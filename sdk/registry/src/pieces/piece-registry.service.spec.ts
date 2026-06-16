import { describe, it, expect, beforeEach } from 'vitest';
import type { Piece } from '@soopa/piece-framework';
import { PieceRegistryService } from '../index.js';

// A minimal mock piece — this service is generic and has no knowledge of real integrations.
const mockPiece: Piece = {
  name: 'mock-app',
  displayName: 'Mock App',
  description: 'A mock application',
  logoUrl: 'https://example.com/logo.png',
  categories: [],
  auth: { type: 'BASIC' } as unknown as Piece['auth'],
  actions: {},
  triggers: {
    new_record: {
      name: 'new_record',
      displayName: 'New Record',
      description: 'Fires on a new record',
      type: 'POLLING',
      props: {},
      run: () => Promise.resolve([]),
      onEnable: () => Promise.resolve(),
      onDisable: () => Promise.resolve(),
    } as Piece['triggers'][string],
  },
};

describe('PieceRegistryService', () => {
  let service: PieceRegistryService;

  beforeEach(() => {
    service = new PieceRegistryService([mockPiece]);
  });

  it('should initialise with the registered piece', () => {
    const piece = service.getPiece('mock-app');
    expect(piece).toBeDefined();
    expect(piece?.name).toBe('mock-app');
  });

  it('should return undefined for an unknown app', () => {
    expect(service.getPiece('unknown_app')).toBeUndefined();
  });

  it('should return a known trigger by name', () => {
    const trigger = service.getTrigger('mock-app', 'new_record');
    expect(trigger).toBeDefined();
    expect(trigger?.name).toBe('new_record');
  });

  it('should return undefined for an unknown trigger', () => {
    expect(service.getTrigger('mock-app', 'does_not_exist')).toBeUndefined();
  });

  it('should return undefined trigger for unknown app', () => {
    expect(service.getTrigger('unknown', 'any')).toBeUndefined();
  });

  it('getAllPieces should return all registered pieces', () => {
    const pieces = service.getAllPieces();
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.map((p: Piece) => p.name)).toContain('mock-app');
  });

  it('should throw on duplicate piece names', () => {
    expect(() => new PieceRegistryService([mockPiece, mockPiece])).toThrow(
      /Duplicate piece name/,
    );
  });

  it('should throw on duplicate alias names', () => {
    const p1 = { ...mockPiece, name: 'p1', aliases: [{ name: 'dup', id: 'a1' }] };
    const p2 = { ...mockPiece, name: 'p2', aliases: [{ name: 'dup', id: 'a2' }] };
    expect(() => new PieceRegistryService([p1 as unknown as Piece, p2 as unknown as Piece])).toThrow(
      /Duplicate alias name/,
    );
  });

  it('resolves base piece name correctly when using an alias', () => {
    const p = { ...mockPiece, name: 'base', aliases: [{ name: 'my-alias', id: 'a1' }] };
    const s = new PieceRegistryService([p as unknown as Piece]);
    expect(s.resolveBasePieceName('my-alias')).toBe('base');
    expect(s.getPiece('my-alias')?.name).toBe('base');
  });

  describe('registerPiece', () => {
    let service: PieceRegistryService;

    beforeEach(() => {
      service = new PieceRegistryService([]);
    });

    it('should dynamically register a piece', () => {
      service.registerPiece(mockPiece);
      expect(service.getPiece('mock-app')).toBeDefined();
    });

    it('should throw if the piece name conflicts with an existing alias for a different piece', () => {
      const existing = { ...mockPiece, name: 'other', aliases: [{ name: 'mock-app', id: 'a1' }] };
      service.registerPiece(existing as unknown as Piece);
      expect(() => service.registerPiece(mockPiece)).toThrow(
        /Name conflict: Piece name "mock-app" is already used as an alias for piece "other"/,
      );
    });

    it('should throw if a new alias conflicts with an existing alias for a different piece', () => {
      const existing = { ...mockPiece, name: 'other', aliases: [{ name: 'shared-alias', id: 'a1' }] };
      service.registerPiece(existing as unknown as Piece);
      const newPiece = { ...mockPiece, aliases: [{ name: 'shared-alias', id: 'a2' }] };
      expect(() => service.registerPiece(newPiece as unknown as Piece)).toThrow(
        /Alias conflict: "shared-alias" is already mapped to piece "other", cannot map to "mock-app"/,
      );
    });

    it('should update piece and clean up old aliases when re-registering', () => {
      const initial = { ...mockPiece, aliases: [{ name: 'old-alias', id: 'a1' }] };
      service.registerPiece(initial as unknown as Piece);
      expect(service.resolveBasePieceName('old-alias')).toBe('mock-app');

      const updated = { ...mockPiece, aliases: [{ name: 'new-alias', id: 'a2' }] };
      service.registerPiece(updated as unknown as Piece);
      expect(service.resolveBasePieceName('old-alias')).toBe('old-alias');
      expect(service.resolveBasePieceName('new-alias')).toBe('mock-app');
    });
  });
});

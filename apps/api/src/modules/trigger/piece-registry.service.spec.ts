import { describe, it, expect, beforeEach } from 'vitest';
import { PieceRegistryService } from './piece-registry.service.js';
import type { Piece } from '@nexiom/connectors';

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
    expect(pieces.map((p) => p.name)).toContain('mock-app');
  });

  it('should throw on duplicate piece names', () => {
    expect(() => new PieceRegistryService([mockPiece, mockPiece])).toThrow(
      /Duplicate piece name/,
    );
  });
});

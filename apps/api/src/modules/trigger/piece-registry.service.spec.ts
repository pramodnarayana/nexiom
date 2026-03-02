import { describe, it, expect, beforeEach } from 'vitest';
import { PieceRegistryService } from './piece-registry.service';

describe('PieceRegistryService', () => {
  let service: PieceRegistryService;

  beforeEach(() => {
    service = new PieceRegistryService();
  });

  it('should initialise with the salesforce piece registered', () => {
    const piece = service.getPiece('salesforce');
    expect(piece).toBeDefined();
    expect(piece?.name).toBe('salesforce');
  });

  it('should return undefined for an unknown app', () => {
    expect(service.getPiece('unknown_app')).toBeUndefined();
  });

  it('should return a known trigger by name', () => {
    const trigger = service.getTrigger('salesforce', 'new_record');
    expect(trigger).toBeDefined();
    expect(trigger?.name).toBe('new_record');
  });

  it('should return undefined for an unknown trigger', () => {
    expect(service.getTrigger('salesforce', 'does_not_exist')).toBeUndefined();
  });

  it('should return undefined trigger for unknown app', () => {
    expect(service.getTrigger('unknown', 'any')).toBeUndefined();
  });

  it('getAllPieces should return all registered pieces', () => {
    const pieces = service.getAllPieces();
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.map((p) => p.name)).toContain('salesforce');
  });
});

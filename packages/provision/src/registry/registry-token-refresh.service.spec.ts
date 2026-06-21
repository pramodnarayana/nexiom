import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest';
import { RegistryOAuthRefreshClient } from './registry-token-refresh.service.js';
import { PieceRegistryService } from '@soopa/piece-registry';
import { PropertyType } from '@soopa/piece-framework';

describe('RegistryOAuthRefreshClient', () => {
  let pieceRegistry: Mocked<PieceRegistryService>;
  let db: any;
  let crypto: any;
  let client: RegistryOAuthRefreshClient;

  beforeEach(() => {
    pieceRegistry = { getPiece: vi.fn() } as any;
    db = {} as any;
    crypto = {} as any;

    client = new RegistryOAuthRefreshClient(pieceRegistry, db, crypto);
  });

  it('throws error if piece is not found', () => {
    pieceRegistry.getPiece.mockReturnValue(undefined);

    expect(() => (client as any).getTokenUrl('unknown-app')).toThrow('Piece not found for refresh: unknown-app');
  });

  it('throws error if piece does not support OAuth2', () => {
    pieceRegistry.getPiece.mockReturnValue({
      auth: { type: PropertyType.SECRET_TEXT },
    } as any);

    expect(() => (client as any).getTokenUrl('basic-app')).toThrow('Piece basic-app does not support OAuth refresh or lacks a token url');
  });

  it('throws error if piece lacks a token url', () => {
    pieceRegistry.getPiece.mockReturnValue({
      auth: { type: PropertyType.OAUTH2 },
    } as any);

    expect(() => (client as any).getTokenUrl('oauth-app')).toThrow('Piece oauth-app does not support OAuth refresh or lacks a token url');
  });

  it('returns token url if piece supports OAuth2 and has tokenUrl', () => {
    pieceRegistry.getPiece.mockReturnValue({
      auth: { type: PropertyType.OAUTH2, tokenUrl: 'https://oauth.url/token' },
    } as any);

    expect((client as any).getTokenUrl('oauth-app')).toBe('https://oauth.url/token');
  });
});

import { describe, it, expect } from 'vitest';
import { extractPieceMetadata } from './piece-metadata.util.js';

const basePiece = {
  name: 'my-app',
  displayName: 'My App',
  logoUrl: 'https://example.com/logo.png',
  description: 'A test app',
  categories: ['CRM'],
  auth: {
    type: 'OAUTH2',
    props: { clientId: { type: 'SHORT_TEXT' } },
  },
  aliases: [{ aliasName: 'old-name' }],
};

describe('extractPieceMetadata', () => {
  describe('Path 1: moduleExports.piece', () => {
    it('should extract metadata when exports.piece is present', () => {
      const result = extractPieceMetadata({ piece: basePiece });
      expect(result).not.toBeNull();
      expect(result!.name).toBe('my-app');
      expect(result!.displayName).toBe('My App');
      expect(result!.logoUrl).toBe('https://example.com/logo.png');
      expect(result!.description).toBe('A test app');
      expect(result!.categories).toEqual(['CRM']);
      expect(result!.authType).toBe('OAUTH2');
      expect(result!.authSchema).toEqual({ clientId: { type: 'SHORT_TEXT' } });
      expect(result!.aliases).toEqual([{ aliasName: 'old-name' }]);
    });

    it('should return null for logoUrl/description/categories/aliases when they are wrong types', () => {
      const result = extractPieceMetadata({
        piece: {
          name: 'my-app',
          displayName: 'My App',
          logoUrl: 123, // not a string
          description: 456, // not a string
          categories: [1, 2, 3], // not strings
          auth: { type: 'OAUTH2' }, // no props
          aliases: 'not-array', // not array
        },
      });
      expect(result).not.toBeNull();
      expect(result!.logoUrl).toBeUndefined();
      expect(result!.description).toBeUndefined();
      expect(result!.categories).toBeUndefined();
      expect(result!.authSchema).toBeUndefined();
      expect(result!.aliases).toBeUndefined();
    });

    it('should handle invalid auth.type (non-string) gracefully', () => {
      const result = extractPieceMetadata({
        piece: {
          name: 'my-app',
          displayName: 'My App',
          auth: { type: 123, props: { key: 'value' } }, // type is not a string
        },
      });
      expect(result).not.toBeNull();
      expect(result!.authType).toBeUndefined();
      expect(result!.authSchema).toBeUndefined();
    });

    it('should handle invalid auth.props (non-object) gracefully', () => {
      const result = extractPieceMetadata({
        piece: {
          name: 'my-app',
          displayName: 'My App',
          auth: { type: 'OAUTH2', props: 'not-an-object' }, // props is not an object
        },
      });
      expect(result).not.toBeNull();
      expect(result!.authType).toBe('OAUTH2');
      expect(result!.authSchema).toBeUndefined();
    });
  });

  describe('Path 2: moduleExports.register()', () => {
    it('should extract metadata via top-level register() function', () => {
      const result = extractPieceMetadata({ register: () => basePiece });
      expect(result).not.toBeNull();
      expect(result!.name).toBe('my-app');
    });

    it('should extract metadata via default.register()', () => {
      const result = extractPieceMetadata({
        default: { register: () => basePiece },
      });
      expect(result).not.toBeNull();
      expect(result!.name).toBe('my-app');
    });

    it('should handle a throwing register() gracefully', () => {
      const result = extractPieceMetadata({
        register: () => { throw new Error('init failed'); },
        // fallback — scan all exports
        fallback: basePiece,
      });
      // Falls through to the export scan, picks up basePiece from 'fallback'
      expect(result).not.toBeNull();
      expect(result!.name).toBe('my-app');
    });
  });

  describe('Path 3: moduleExports.default (plain object)', () => {
    it('should extract metadata from a default export object', () => {
      const result = extractPieceMetadata({ default: basePiece });
      expect(result).not.toBeNull();
      expect(result!.name).toBe('my-app');
    });
  });

  describe('Path 4: fallback export scan', () => {
    it('should scan all exports and find a piece-like object', () => {
      const result = extractPieceMetadata({ somePieceExport: basePiece });
      expect(result).not.toBeNull();
      expect(result!.name).toBe('my-app');
    });

    it('should handle throwing default.register() in export scan and skip', () => {
      const result = extractPieceMetadata({
        default: {
          register: () => { throw new Error('fail'); },
        },
        directExport: basePiece,
      });
      expect(result).not.toBeNull();
      expect(result!.name).toBe('my-app');
    });
  });

  describe('Null cases', () => {
    it('should return null if no valid piece is found anywhere', () => {
      const result = extractPieceMetadata({ foo: 'bar', baz: 123 });
      expect(result).toBeNull();
    });

    it('should return null if piece object has no name', () => {
      const result = extractPieceMetadata({ piece: { displayName: 'X' } });
      expect(result).toBeNull();
    });

    it('should return null if piece object has no displayName', () => {
      const result = extractPieceMetadata({ piece: { name: 'x' } });
      expect(result).toBeNull();
    });

    it('should return null for an empty module', () => {
      expect(extractPieceMetadata({})).toBeNull();
    });
  });
});

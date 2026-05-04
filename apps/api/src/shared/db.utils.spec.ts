import {
  extractPgError,
  isUniqueViolation,
  PG_UNIQUE_VIOLATION,
} from './db.utils.js';

describe('db.utils', () => {
  describe('extractPgError', () => {
    it('returns null for non-objects', () => {
      expect(extractPgError(null)).toBeNull();
      expect(extractPgError(undefined)).toBeNull();
      expect(extractPgError('string')).toBeNull();
      expect(extractPgError(123)).toBeNull();
    });

    it('extracts code and constraint from a direct pg error', () => {
      const error = { code: '23505', constraint: 'unique_email' };
      expect(extractPgError(error)).toEqual({
        code: '23505',
        constraint: 'unique_email',
      });
    });

    it('extracts code and constraint from a Drizzle wrapped error (cause)', () => {
      const error = {
        message: 'Drizzle query failed',
        cause: { code: '23505', constraint: 'unique_email' },
      };
      expect(extractPgError(error)).toEqual({
        code: '23505',
        constraint: 'unique_email',
      });
    });

    it('returns null if cause is present but not an object', () => {
      const error = { cause: 'string cause' };
      expect(extractPgError(error)).toBeNull();
    });

    it('returns null if cause is present but has no code string', () => {
      const error = { cause: { code: 123 } };
      expect(extractPgError(error)).toBeNull();
    });

    it('returns null for non-string direct code', () => {
      const error = { code: 123 };
      expect(extractPgError(error)).toBeNull();
    });
  });

  describe('isUniqueViolation', () => {
    it('returns true for a direct unique violation error', () => {
      const error = { code: PG_UNIQUE_VIOLATION };
      expect(isUniqueViolation(error)).toBe(true);
    });

    it('returns true for a Drizzle wrapped unique violation error', () => {
      const error = { cause: { code: PG_UNIQUE_VIOLATION } };
      expect(isUniqueViolation(error)).toBe(true);
    });

    it('returns false for other errors', () => {
      const error = { code: '12345' };
      expect(isUniqueViolation(error)).toBe(false);
    });

    it('returns false for non-pg errors', () => {
      expect(isUniqueViolation(new Error('Normal error'))).toBe(false);
    });
  });
});

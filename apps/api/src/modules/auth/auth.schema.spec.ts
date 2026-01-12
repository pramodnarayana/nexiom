import * as schema from './auth.schema';

describe('Auth Schema', () => {
  describe('Table Exports', () => {
    it('should export user table', () => {
      expect(schema.user).toBeDefined();
      expect(typeof schema.user).toBe('object');
    });

    it('should export session table', () => {
      expect(schema.session).toBeDefined();
      expect(typeof schema.session).toBe('object');
    });

    it('should export account table', () => {
      expect(schema.account).toBeDefined();
      expect(typeof schema.account).toBe('object');
    });

    it('should export verification table', () => {
      expect(schema.verification).toBeDefined();
      expect(typeof schema.verification).toBe('object');
    });
  });

  describe('Type Exports', () => {
    it('should have User type available', () => {
      // Types can't be tested at runtime, but we verify the table exists
      expect(schema.user).toBeDefined();
    });

    it('should have Session type available', () => {
      expect(schema.session).toBeDefined();
    });
  });
});

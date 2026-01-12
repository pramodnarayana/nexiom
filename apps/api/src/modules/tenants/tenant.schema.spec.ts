import * as schema from './tenant.schema';

describe('Tenant Schema', () => {
  describe('Table Exports', () => {
    it('should export organization table', () => {
      expect(schema.organization).toBeDefined();
      expect(typeof schema.organization).toBe('object');
    });

    it('should export member table', () => {
      expect(schema.member).toBeDefined();
      expect(typeof schema.member).toBe('object');
    });
  });

  describe('Enum Exports', () => {
    it('should export organizationStatusEnum', () => {
      expect(schema.organizationStatusEnum).toBeDefined();
    });
  });

  describe('Type Exports', () => {
    it('should have Organization type available', () => {
      expect(schema.organization).toBeDefined();
    });

    it('should have Member type available', () => {
      expect(schema.member).toBeDefined();
    });
  });
});

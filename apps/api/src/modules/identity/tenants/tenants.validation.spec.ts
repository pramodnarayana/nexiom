import {
  UpdateTenantStatusSchema,
  UpdateTenantStatus,
} from './tenants.validation';

describe('Tenants Validation', () => {
  describe('UpdateTenantStatusSchema', () => {
    it('should validate active status', () => {
      const validStatus = { status: 'active' };
      const result = UpdateTenantStatusSchema.safeParse(validStatus);
      expect(result.success).toBe(true);
    });

    it('should validate disabled status', () => {
      const validStatus = { status: 'disabled' };
      const result = UpdateTenantStatusSchema.safeParse(validStatus);
      expect(result.success).toBe(true);
    });

    it('should validate suspended status', () => {
      const validStatus = { status: 'suspended' };
      const result = UpdateTenantStatusSchema.safeParse(validStatus);
      expect(result.success).toBe(true);
    });

    it('should reject invalid status', () => {
      const invalidStatus = { status: 'archived' };
      const result = UpdateTenantStatusSchema.safeParse(invalidStatus);
      expect(result.success).toBe(false);
    });

    it('should reject empty status', () => {
      const invalidStatus = { status: '' };
      const result = UpdateTenantStatusSchema.safeParse(invalidStatus);
      expect(result.success).toBe(false);
    });

    it('should reject missing status field', () => {
      const invalidStatus = {};
      const result = UpdateTenantStatusSchema.safeParse(invalidStatus);
      expect(result.success).toBe(false);
    });

    it('should reject null status', () => {
      const invalidStatus = { status: null };
      const result = UpdateTenantStatusSchema.safeParse(invalidStatus);
      expect(result.success).toBe(false);
    });

    it('should provide custom error message for invalid status', () => {
      const invalidStatus = { status: 'invalid' };
      const result = UpdateTenantStatusSchema.safeParse(invalidStatus);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          'Status must be active, disabled, or suspended',
        );
      }
    });
  });

  describe('UpdateTenantStatus Class', () => {
    it('should be instantiable', () => {
      expect(() => new UpdateTenantStatus()).not.toThrow();
    });
  });
});

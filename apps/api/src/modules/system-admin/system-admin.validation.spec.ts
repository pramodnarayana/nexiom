import {
  CreateTenantSchema,
  UpdateTenantSchema,
  CreateUserSchema,
  UpdateUserSchema,
} from './system-admin.validation';

describe('SystemAdminValidation', () => {
  describe('CreateTenantSchema', () => {
    it('should pass with valid data', () => {
      const result = CreateTenantSchema.safeParse({
        name: 'Test Corp',
        slug: 'test-corp',
        logo: 'https://example.com/logo.png',
      });
      expect(result.success).toBe(true);
    });

    it('should fail if name is missing', () => {
      const result = CreateTenantSchema.safeParse({
        slug: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('should fail if slug is too short', () => {
      const result = CreateTenantSchema.safeParse({
        name: 'Test',
        slug: 'no',
      });
      expect(result.success).toBe(false);
    });

    it('should fail if slug contains invalid chars', () => {
      const result = CreateTenantSchema.safeParse({
        name: 'Test',
        slug: 'Test Corp',
      });
      expect(result.success).toBe(false);
    });

    it('should allow empty logo', () => {
      const result = CreateTenantSchema.safeParse({
        name: 'Test',
        slug: 'test',
        logo: '',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('UpdateTenantSchema', () => {
    it('should pass with partial updates', () => {
      const result = UpdateTenantSchema.safeParse({
        name: 'New Name',
      });
      expect(result.success).toBe(true);
    });

    it('should validate slug on update', () => {
      const result = UpdateTenantSchema.safeParse({
        slug: 'bad slug',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('CreateUserSchema', () => {
    it('should pass with valid data', () => {
      const result = CreateUserSchema.safeParse({
        name: 'Admin User',
        email: 'admin@nexiom.com',
        systemRole: 'platform_admin',
      });
      expect(result.success).toBe(true);
    });

    it('should default systemRole to user', () => {
      const result = CreateUserSchema.parse({
        name: 'Standard User',
        email: 'user@nexiom.com',
      });
      expect(result.systemRole).toBe('user');
    });

    it('should fail with invalid email', () => {
      const result = CreateUserSchema.safeParse({
        name: 'Test',
        email: 'not-an-email',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateUserSchema', () => {
    it('should allow partial updates', () => {
      const result = UpdateUserSchema.safeParse({
        systemRole: 'platform_admin',
      });
      expect(result.success).toBe(true);
    });
  });
});

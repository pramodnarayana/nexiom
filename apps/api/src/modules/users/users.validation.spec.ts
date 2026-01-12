import {
  CreateUserSchema,
  CreateUser,
  Signup,
  SignupSchema,
} from './users.validation';

describe('Users Validation', () => {
  describe('CreateUserSchema', () => {
    it('should validate a valid user with all fields', () => {
      const validUser = {
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        companyName: 'Test Corp',
        role: 'admin',
        password: 'SecurePass123',
      };

      const result = CreateUserSchema.safeParse(validUser);
      expect(result.success).toBe(true);
    });

    it('should validate a user with only email', () => {
      const minimalUser = {
        email: 'test@example.com',
      };

      const result = CreateUserSchema.safeParse(minimalUser);
      expect(result.success).toBe(true);
    });

    it('should reject invalid email format', () => {
      const invalidUser = {
        email: 'not-an-email',
      };

      const result = CreateUserSchema.safeParse(invalidUser);
      expect(result.success).toBe(false);
    });

    it('should reject invalid role', () => {
      const invalidUser = {
        email: 'test@example.com',
        role: 'superadmin', // Not in allowed roles
      };

      const result = CreateUserSchema.safeParse(invalidUser);
      expect(result.success).toBe(false);
    });

    it('should reject company name less than 2 characters', () => {
      const invalidUser = {
        email: 'test@example.com',
        companyName: 'A',
      };

      const result = CreateUserSchema.safeParse(invalidUser);
      expect(result.success).toBe(false);
    });

    it('should accept all valid roles', () => {
      const roles = ['admin', 'editor', 'viewer', 'user'];

      roles.forEach((role) => {
        const user = {
          email: 'test@example.com',
          role,
        };
        const result = CreateUserSchema.safeParse(user);
        expect(result.success).toBe(true);
      });
    });

    it('should default role to user if not provided', () => {
      const user = {
        email: 'test@example.com',
      };
      const result = CreateUserSchema.safeParse(user);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.role).toBe('user');
      }
    });
  });

  describe('SignupSchema', () => {
    it('should validate a valid signup with all required fields', () => {
      const validSignup = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        companyName: 'Test Corp', // Required for signup
        firstName: 'John',
        lastName: 'Doe',
      };

      const result = SignupSchema.safeParse(validSignup);
      expect(result.success).toBe(true);
    });

    it('should require email, password, and companyName', () => {
      const invalidSignup = {
        email: 'test@example.com',
        password: 'password123',
        // Missing companyName
      };

      const result = SignupSchema.safeParse(invalidSignup);
      expect(result.success).toBe(false);
    });

    it('should reject invalid email in signup', () => {
      const invalidSignup = {
        email: 'invalid',
        password: 'password123',
        companyName: 'Test Corp',
      };

      const result = SignupSchema.safeParse(invalidSignup);
      expect(result.success).toBe(false);
    });

    it('should require password to be at least 8 characters', () => {
      const invalidSignup = {
        email: 'test@example.com',
        password: 'short',
        companyName: 'Test Corp',
      };

      const result = SignupSchema.safeParse(invalidSignup);
      expect(result.success).toBe(false);
    });

    it('should validate signup with minimal required fields', () => {
      const minimalSignup = {
        email: 'test@example.com',
        password: 'password123',
        companyName: 'Test Corp',
      };

      const result = SignupSchema.safeParse(minimalSignup);
      expect(result.success).toBe(true);
    });

    it('should reject companyName less than 2 characters', () => {
      const invalidSignup = {
        email: 'test@example.com',
        password: 'password123',
        companyName: 'A',
      };

      const result = SignupSchema.safeParse(invalidSignup);
      expect(result.success).toBe(false);
    });
  });

  describe('CreateUser Class', () => {
    it('should be instantiable', () => {
      expect(() => new CreateUser()).not.toThrow();
    });
  });

  describe('Signup Class', () => {
    it('should be instantiable', () => {
      expect(() => new Signup()).not.toThrow();
    });
  });
});

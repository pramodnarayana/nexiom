import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateTenantSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z
    .string()
    .min(3, 'Slug must be at least 3 characters')
    .regex(
      /^[a-z0-9-]+$/,
      'Slug must contain only lowercase letters, numbers, and hyphens',
    ),
  logo: z.string().url().optional().or(z.literal('')),
});

export class CreateTenantValidation extends createZodDto(CreateTenantSchema) {}

export const UpdateTenantSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z
    .string()
    .min(3)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  logo: z.string().url().optional().or(z.literal('')),
  status: z.enum(['active', 'disabled', 'suspended']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export class UpdateTenantValidation extends createZodDto(UpdateTenantSchema) {}

export const UpdateUserSchema = z.object({
  name: z.string().min(1).optional(),
  systemRole: z.enum(['user', 'platform_admin']).optional(),
  email: z.string().email().optional(), // In case we want to allow email updates, though risky
  emailVerified: z.boolean().optional(),
});

export class UpdateUserValidation extends createZodDto(UpdateUserSchema) {}

export const CreateUserSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  systemRole: z.enum(['user', 'platform_admin']).default('user'),
});

export class CreateUserValidation extends createZodDto(CreateUserSchema) {}

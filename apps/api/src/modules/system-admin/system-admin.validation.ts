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

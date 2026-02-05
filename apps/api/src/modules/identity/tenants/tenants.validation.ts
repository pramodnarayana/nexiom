import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const UpdateTenantStatusSchema = z.object({
  status: z.enum(['active', 'disabled', 'suspended'], {
    error: 'Status must be active, disabled, or suspended',
  }),
});

export class UpdateTenantStatus extends createZodDto(
  UpdateTenantStatusSchema,
) {}

export const UpdateTenantSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z
    .string()
    .min(3)
    .regex(/^[a-z0-9-]+$/, {
      message: 'Slug can only contain lowercase letters, numbers, and hyphens',
    })
    .optional(),
});

export class UpdateTenantDto extends createZodDto(UpdateTenantSchema) {}

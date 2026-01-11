import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const UpdateOrganizationStatusSchema = z.object({
  status: z.enum(['active', 'disabled', 'suspended'], {
    message: 'Status must be active, disabled, or suspended',
  }),
});

export class UpdateOrganizationStatus extends createZodDto(
  UpdateOrganizationStatusSchema,
) {}

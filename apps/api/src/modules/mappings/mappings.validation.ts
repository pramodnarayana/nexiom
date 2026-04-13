import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateMappingSchema = z.object({
  appName: z.string().min(1, 'App name is required'),
  category: z.string().min(1, 'Category is required'),
  entity: z.string().min(1, 'Entity is required'),
  viewMode: z.string().min(1, 'View mode is required'),
  tenantId: z.string().optional(),
  version: z.string().optional().default('v1'),
  mappingConfig: z.record(z.string(), z.any()),
});

export const UpdateMappingSchema = CreateMappingSchema.partial();

export class CreateMapping extends createZodDto(CreateMappingSchema) {}
export class UpdateMapping extends createZodDto(UpdateMappingSchema) {}

import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// Base schema without defaults
const BaseMappingSchema = z.object({
  appName: z.string().min(1, 'App name is required'),
  category: z.string().min(1, 'Category is required'),
  entity: z.string().min(1, 'Entity is required'),
  viewMode: z.string().min(1, 'View mode is required'),
  version: z.string().optional(),
  mappingConfig: z.record(z.string(), z.any()),
});

// Create schema with default for version
export const CreateMappingSchema = BaseMappingSchema.extend({
  version: z.string().optional().default('v1'),
});

// Update schema without defaults
export const UpdateMappingSchema = BaseMappingSchema.partial();

export class CreateMapping extends createZodDto(CreateMappingSchema) {}
export class UpdateMapping extends createZodDto(UpdateMappingSchema) {}

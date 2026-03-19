import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(255),
  envType: z.enum(['PRODUCTION', 'SANDBOX']).optional(),
});

export const UpdateWorkspaceSchema = CreateWorkspaceSchema.partial();

export class CreateWorkspace extends createZodDto(CreateWorkspaceSchema) {}
export class UpdateWorkspace extends createZodDto(UpdateWorkspaceSchema) {}

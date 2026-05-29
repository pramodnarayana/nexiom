import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const ExecuteConnectionSchema = z.object({
  dataSourceId: z.string().uuid(),
});

export class ExecuteConnectionBody extends createZodDto(
  ExecuteConnectionSchema,
) {}

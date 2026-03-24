import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const ExecuteStitchSchema = z.object({
  stitchId: z.string().uuid(),
});

export class ExecuteStitchBody extends createZodDto(ExecuteStitchSchema) {}

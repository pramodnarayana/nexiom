import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { SYNC_INTERVAL_OPTIONS } from '@nexiom/database';

export const UpdateScheduleSchema = z.object({
  syncIntervalMinutes: z
    .number()
    .int()
    .refine((v) => (SYNC_INTERVAL_OPTIONS as readonly number[]).includes(v), {
      message: `Must be one of: ${SYNC_INTERVAL_OPTIONS.join(', ')}`,
    })
    .optional(),
  scheduleEnabled: z.boolean().optional(),
});

/** Admin variant: any positive integer allowed */
export const AdminUpdateScheduleSchema = z.object({
  syncIntervalMinutes: z.number().int().positive().optional(),
  scheduleEnabled: z.boolean().optional(),
});

export class UpdateScheduleBody extends createZodDto(UpdateScheduleSchema) {}
export class AdminUpdateScheduleBody extends createZodDto(
  AdminUpdateScheduleSchema,
) {}

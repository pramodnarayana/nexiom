import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { SYNC_INTERVAL_OPTIONS } from '@nexiom/database';

/**
 * A single filter rule evaluated at L4 (Fan-Out Decision layer).
 * Shape mirrors the `sync_condition` JSONB column comment in `stitches.ts`.
 *   { "field": "Region", "op": "eq", "value": "US", "logic": "AND" }
 */
const SyncConditionRule = z.object({
  field: z.string().min(1),
  op: z.enum(['eq', 'neq', 'gt', 'lt', 'contains']),
  value: z.union([z.string(), z.number(), z.boolean()]),
  logic: z.enum(['AND', 'OR']).optional(),
});

const syncIntervalMinutes = z
  .number()
  .int()
  .refine((v) => (SYNC_INTERVAL_OPTIONS as readonly number[]).includes(v), {
    message: `Must be one of: ${SYNC_INTERVAL_OPTIONS.join(', ')}`,
  })
  .optional();

export const CreateStitchSchema = z.object({
  name: z.string().trim().min(1).max(255),
  workspaceId: z.string().uuid(),
  srcConnectionId: z.string().uuid(),
  destConnectionId: z.string().uuid(),
  sourceObject: z.string().trim().max(255).optional().default(''),
  targetObject: z.string().trim().max(255).optional().default(''),
  syncCondition: z.array(SyncConditionRule).optional(),
  status: z.enum(['ACTIVE', 'PAUSED']).optional(),
  syncIntervalMinutes,
  scheduleEnabled: z.boolean().optional(),
});

export const UpdateStitchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
  syncCondition: z.array(SyncConditionRule).optional(),
  syncIntervalMinutes,
  scheduleEnabled: z.boolean().optional(),
});

export class CreateStitch extends createZodDto(CreateStitchSchema) {}
export class UpdateStitch extends createZodDto(UpdateStitchSchema) {}

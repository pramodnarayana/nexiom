import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * A single filter rule evaluated at L4 (Fan-Out Decision layer).
 * Shape mirrors the `sync_condition` JSONB column comment in `stitches.ts`.
 *   { "field": "Region", "op": "eq", "value": "US", "logic": "AND" }
 */
export const SyncConditionRule = z.object({
  field: z.string().min(1),
  op: z.enum(['eq', 'neq', 'gt', 'lt', 'contains']),
  value: z.union([z.string(), z.number(), z.boolean()]),
  logic: z.enum(['AND', 'OR']).optional(),
});

/**
 * Inline field-mapping rule — mirrors UpsertFieldMappingSchema.
 * Embedded here so the create endpoint can atomically persist stitch + mappings
 * in a single transaction, preventing orphaned stitch rows on partial failure.
 */
const FieldMappingRule = z.object({
  src: z.string().trim().min(1),
  dest: z.string().trim().min(1),
  transform: z.string().trim().min(1).optional(),
});

const InitialFieldMapping = z.object({
  sourceCanonical: z.string().trim().min(1).max(100),
  // min(1): an empty rules array is a no-op that wastes a DB row.
  mappingRules: z.array(FieldMappingRule).min(1).max(200),
});

export const CreateStitchSchema = z.object({
  name: z.string().trim().min(1).max(255),
  workspaceId: z.string().uuid(),
  sourceDataSourceId: z.string().uuid(),
  destDataSourceId: z.string().uuid(),
  canonicalObject: z.string().trim().max(255).optional().default(''),
  targetObject: z.string().trim().max(255).optional().default(''),
  syncCondition: z.array(SyncConditionRule).optional(),
  status: z.enum(['ACTIVE', 'PAUSED']).optional(),
  /**
   * Optional field mappings to create atomically with the stitch.
   * Prevents orphaned stitch rows when the mapping save step would otherwise
   * fail after the stitch has already been inserted.
   */
  fieldMappings: z.array(InitialFieldMapping).max(50).optional(),
});

export const UpdateStitchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
  syncCondition: z.array(SyncConditionRule).optional(),
});

export class CreateStitch extends createZodDto(CreateStitchSchema) {}
export class UpdateStitch extends createZodDto(UpdateStitchSchema) {}

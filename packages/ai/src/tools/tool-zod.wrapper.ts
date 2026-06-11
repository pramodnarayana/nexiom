import { zodSchema } from 'ai';
import { z } from 'zod';

/**
 * Wraps zodSchema() with an explicit `any` boundary.
 *
 * Temporary workaround for TypeScript compiler error TS2589 (type instantiation excessively deep)
 * that occurs with complex Zod schemas in runtime-validated dynamicTool usage.
 * The runtime validation remains correct; this suppression will be removed once the
 * TypeScript generic depth issue is resolved.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toAISchema(schema: z.ZodTypeAny): any {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  return zodSchema(schema);
}
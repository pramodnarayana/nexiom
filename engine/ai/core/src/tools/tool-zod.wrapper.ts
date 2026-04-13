import { zodSchema } from 'ai';
import { z } from 'zod';

/**
 * Wraps zodSchema() with an explicit `any` boundary.
 * zodSchema<T> recursively resolves Zod's complex generic tree, causing TS2589
 * ("type instantiation excessively deep") with Zod v3.25+ inside dynamicTool generics.
 * This wrapper breaks the chain — dynamicTool validates the schema at runtime anyway.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toAISchema(schema: z.ZodTypeAny): any {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore TS2589 — Zod v3.25 generic depth overflows tsc; runtime is correct
  return zodSchema(schema);
}

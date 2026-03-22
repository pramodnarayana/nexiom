import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const MappingRule = z.object({
  src: z.string().trim().min(1), // JSONPath source field, e.g. "$.rtms__Total_Amount__c"
  dest: z.string().trim().min(1), // JSONPath dest field, e.g. "$.TotalAmt"
  transform: z.string().trim().min(1).optional(), // optional expression; whitespace-only is rejected
});

export const UpsertFieldMappingSchema = z.object({
  sourceCanonical: z.string().trim().min(1).max(100),
  // An empty array is valid and signals "clear all mappings for this canonical".
  mappingRules: z.array(MappingRule).max(200),
});

export class UpsertFieldMappingBody extends createZodDto(
  UpsertFieldMappingSchema,
) {}

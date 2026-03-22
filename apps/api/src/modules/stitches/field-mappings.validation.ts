import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const MappingRule = z.object({
  src: z.string().trim().min(1), // JSONPath source field, e.g. "$.rtms__Total_Amount__c"
  dest: z.string().trim().min(1), // JSONPath dest field, e.g. "$.TotalAmt"
  transform: z.string().optional(), // optional expression
});

export const UpsertFieldMappingSchema = z.object({
  sourceCanonical: z.string().trim().min(1).max(100),
  mappingRules: z.array(MappingRule).max(200),
});

export class UpsertFieldMappingBody extends createZodDto(
  UpsertFieldMappingSchema,
) {}

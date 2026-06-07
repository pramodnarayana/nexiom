import { z } from 'zod';

export const WebhookIngestedEventSchema = z.object({
  eventId: z.string().uuid(),
  tenantId: z.string(),
  connectionId: z.string(),
  payload: z.record(z.string(), z.unknown()),
  headers: z.record(z.string(), z.string()),
  timestamp: z.number(),
});

export type WebhookIngestedEvent = z.infer<typeof WebhookIngestedEventSchema>;

export const ReplicaExtractedEventSchema = z.object({
  traceId: z.string(),
  tenantId: z.string(),
  connectionId: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  data: z.record(z.string(), z.unknown()),
  timestamp: z.number(),
});

export type ReplicaExtractedEvent = z.infer<typeof ReplicaExtractedEventSchema>;

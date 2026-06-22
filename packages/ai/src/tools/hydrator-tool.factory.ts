import { Injectable, Logger } from '@nestjs/common';
import { dynamicTool } from 'ai';
import { z } from 'zod';
import { toAISchema } from './tool-zod.wrapper.js';
import { MetadataDiscoveryService } from '@soopa/piece-registry';
import { MappingService } from '../categories/mapping.service.js';
import { Transformer } from '@soopa/transformer';
import type { Piece } from '@soopa/piece-framework';

const MAX_PARALLEL_RELATED_CALLS = 5;

@Injectable()
export class HydratorToolFactory {
  private readonly logger = new Logger(HydratorToolFactory.name);

  constructor(
    private readonly metadataService: MetadataDiscoveryService,
    private readonly mappingService: MappingService,
  ) {}

  buildHydratorTool(
    tools: Record<string, ReturnType<typeof dynamicTool>>,
    piece: Piece,
    conn: { id: string; appName: string },
    creds: Record<string, unknown>,
    traceId: string,
    tenantId: string,
  ): void {
    if (typeof piece.describeRelatedObjects !== 'function') return;

    const toolName = `${conn.appName}_${conn.id}_getEntityWithRelations`;

    const hydratorInputSchema = z.object({
      objectType: z
        .string()
        .describe(
          `The primary entity type (e.g. 'Load', 'Invoice', 'Account', 'Order')`,
        ),
      filters: z
        .record(z.string(), z.string())
        .describe(
          `Properties to search by. E.g. {"Name": "211032"} or {"DocNumber": "123"}. Prefer intuitive visual identifiers.`,
        ),
    });

    tools[toolName] = dynamicTool({
      description: [
        `Fetches an entity along with its related data in a single call.`,
        `Use this when the user asks for details or a complete view of a record.`,
      ].join(' '),
      inputSchema: toAISchema(hydratorInputSchema),
      execute: async (input: unknown) => {
        const { objectType, filters } = input as z.infer<typeof hydratorInputSchema>;
        const objectTypeName: string = objectType;
        const filterMap: Record<string, string> = filters;
        this.logger.log(`[${traceId}] Hydrating entity with all relations for app: ${conn.appName}`);

        try {
          const objects = await this.metadataService.describeObjects(tenantId, conn.id);

          const tName = objectTypeName.toLowerCase();
          let resolvedObjectName: string = objectTypeName;
          const match =
            objects.find((o) => o.label === objectTypeName) ||
            objects.find(
              (o) =>
                o.name.toLowerCase() === tName ||
                o.label.toLowerCase() === tName,
            );

          if (match) {
            resolvedObjectName = match.name;
          } else {
            return {
              connectionName: `connection-${conn.id}`,
              error: `Object type "${objectTypeName}" not found in metadata dictionary. Please use a valid object type from the available metadata.`,
            };
          }

          let primaryResult: Record<string, unknown> | null = null;

          if (!piece.executeFind) {
            primaryResult = {
              error: `executeFind is not implemented natively on connection ${conn.appName}`,
            };
          } else {
            try {
               // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
              const results = await piece.executeFind(resolvedObjectName, filterMap, creds as any);
              if (Array.isArray(results) && results.length > 0) {
                primaryResult = results[0] as Record<string, unknown>;
              } else if (results && !Array.isArray(results)) {
                primaryResult = results as Record<string, unknown>;
              }
            } catch (e: unknown) {
              primaryResult = {
                error: `Failed to find ${resolvedObjectName}: ${(e as Error).message}`,
              };
            }
          }

          const primaryId = primaryResult?.Id || primaryResult?.id || primaryResult?.internalId;

          if (!primaryResult || primaryResult.error || !primaryId) {
            return {
              connectionName: `connection-${conn.id}`,
              error:
                primaryResult?.error ||
                `No records found in ${resolvedObjectName} matching filters ${JSON.stringify(filters)}. Cannot join relationship graph.`,
            };
          }

          const relatedObjects = await this.metadataService.describeRelatedObjects(tenantId, conn.id, resolvedObjectName);

          const relatedResults: Record<string, unknown>[] = [];
          for (let i = 0; i < relatedObjects.length; i += MAX_PARALLEL_RELATED_CALLS) {
            const batch = relatedObjects.slice(i, i + MAX_PARALLEL_RELATED_CALLS);
            const batchResults = await Promise.all(
              batch.map(async (rel) => {
                if (!piece.executeFind) {
                  return {
                    objectType: rel.objectName,
                    relationshipType: rel.relationshipType,
                    records: [],
                    _note: 'executeFind not implemented on this piece',
                  };
                }

                try {
                  const filterProp = { [rel.relationField]: primaryId as string };
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                  const records = await piece.executeFind(rel.objectName, filterProp, creds as any);
                  return {
                    objectType: rel.objectName,
                    relationshipType: rel.relationshipType,
                    records: Array.isArray(records) ? records : [records],
                  };
                } catch (e: unknown) {
                  return {
                    objectType: rel.objectName,
                    relationshipType: rel.relationshipType,
                    records: [],
                    error: `Failed to fetch related ${rel.objectName}: ${(e as Error).message}`,
                  };
                }
              }),
            );
            relatedResults.push(...batchResults);
          }

          const assumedCategory = 'TMS';
          const viewMode = 'summary';

          const mappingConfig = await this.mappingService.getMapping(
            conn.appName,
            assumedCategory,
            resolvedObjectName,
            viewMode,
            tenantId
          );

          const validRelations = relatedResults.filter(
            (r: Record<string, unknown>) => r && Array.isArray(r.records) && r.records.length > 0,
          );

          const rawPayload = {
            connectionName: `connection-${conn.id}`,
            [resolvedObjectName]: primaryResult,
            relations: Object.fromEntries(
              validRelations.map((r: Record<string, unknown>) => [
                `${String(r.objectType)}|${String(r.relationshipType)}`,
                r,
              ]),
            ),
          };

          let finalPayload: Record<string, unknown> = rawPayload;

          if (mappingConfig) {
            this.logger.log(`[${traceId}] Applying strict Canonical JSON Transformation...`);
            finalPayload = new Transformer(mappingConfig as Record<string, unknown>).transform(rawPayload, {
              traceId,
              tenantId,
              logger: this.logger
            }) as Record<string, unknown>;
          }

          const payloadLength = JSON.stringify(finalPayload).length;
          this.logger.log(`[${traceId}] Handing pristine resolved graph to Vercel AI SDK... byteSize: ${payloadLength}`);

          // PER USER REQUEST: Withholding finalPayload to prevent token bloat
          return { _secure_debug: "Tool successfully fetched live data. Check terminal for specific finalPayload size. Data withheld from AI to prevent 8k token bloat during testing phase." };
        } catch (e: unknown) {
          this.logger.error(`[${traceId}] Entity hydration failed`, (e as Error).stack);
          throw e;
        }
      },
    });
  }
}

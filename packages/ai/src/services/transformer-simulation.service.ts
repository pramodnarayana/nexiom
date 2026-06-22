/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Injectable, Logger, BadRequestException, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION, dataSources } from '@soopa/database';
import { eq, and } from 'drizzle-orm';
import type { DrizzleDb } from '@soopa/database';
import { TokenManagerService } from '@soopa/credentials';
import { PieceRegistryService } from '@soopa/piece-registry';
import { MetadataDiscoveryService } from '@soopa/piece-registry';
import { MappingService } from '../categories/mapping.service.js';
import { Transformer } from '@soopa/transformer';
import { optimizePayloadTokens } from '../transformers/token-optimizer.util.js';

@Injectable()
export class TransformerSimulationService {
  private readonly logger = new Logger(TransformerSimulationService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly tokenManager: TokenManagerService,
    private readonly pieceRegistry: PieceRegistryService,
    private readonly metadataService: MetadataDiscoveryService,
    private readonly mappingService: MappingService,
  ) {}

  /**
   * Enterprise Debug Simulation
   * Exclusively processes raw data fetch + transformation bypassing AI completely.
   */
  async simulateExecution(
    tenantId: string,
    connectionId: string,
    toolType: 'hydrator' | 'action',
    actionName: string | null,
    payload: Record<string, any>,
  ): Promise<any> {
    const startTime = Date.now();
    
    // 1. Resolve Connection
    const [conn] = await this.db.select({
      id: dataSources.id,
      appName: dataSources.appName,
    })
    .from(dataSources)
    .where(
      and(
        eq(dataSources.id, connectionId),
        eq(dataSources.tenantId, tenantId)
      )
    );

    if (!conn) {
      throw new BadRequestException(`Connection ${connectionId} not found or inactive`);
    }

    // 2. Load Tools & Creds
    const piece = this.pieceRegistry.getPiece(conn.appName);
    if (!piece) {
        throw new BadRequestException(`Piece ${conn.appName} not found in registry`);
    }

    const credentials = (await this.tokenManager.getValidCredentials(conn.id)) as any;

    let rawData: any = null;
    let transformedData: any = null;

    if (toolType === 'action') {
      if (!actionName || !piece.actions?.[actionName]) {
        throw new BadRequestException(`Action ${actionName} not supported by piece ${conn.appName}`);
      }
      const action = piece.actions[actionName];
      rawData = await action.run({ auth: credentials, propsValue: payload });
      transformedData = optimizePayloadTokens(rawData) || rawData;

    } else if (toolType === 'hydrator') {
      // Inline the Hydrator tool logic for precise telemetry tracking
      const { objectType, filters } = payload;
      if (!piece.executeFind) {
          throw new BadRequestException(`executeFind not natively supported by piece ${conn.appName}`);
      }
      
      const objects = await this.metadataService.describeObjects(tenantId, conn.id);
      const match = objects.find(o => o.label === objectType || o.name === objectType);
      const resolvedObjectName = match ? match.name : objectType;

      const results = await piece.executeFind(resolvedObjectName, filters, credentials);
      let primaryResult: any = Array.isArray(results) ? results[0] : results;
      
      if (!primaryResult) {
          return { error: 'No records found' };
      }

      const primaryId = primaryResult.Id || primaryResult.id || primaryResult.internalId;
      const relatedObjects = await this.metadataService.describeRelatedObjects(tenantId, conn.id, resolvedObjectName);
      
      const relatedResults = [];
      for (const rel of relatedObjects) {
          try {
              const relRecords = await piece.executeFind(rel.objectName, { [rel.relationField]: primaryId }, credentials);
              relatedResults.push({
                  objectType: rel.objectName,
                  relationshipType: rel.relationshipType,
                  records: Array.isArray(relRecords) ? relRecords : [relRecords]
              });
          } catch (e) {
              this.logger.warn(`Failed to fetch related ${rel.objectName}`, e);
          }
      }

      rawData = {
          connectionName: conn.appName,
          [resolvedObjectName]: primaryResult,
          relations: Object.fromEntries(relatedResults.filter(r => r.records?.length).map(r => [`${r.objectType}|${r.relationshipType}`, r]))
      };

      const mappingConfig = await this.mappingService.getMapping(
          conn.appName,
          payload.assumedCategory || 'TMS',
          resolvedObjectName,
          payload.viewMode || 'summary',
          tenantId
      );

      transformedData = mappingConfig
          ? new Transformer(mappingConfig as Record<string, unknown>).transform(rawData, {
              traceId: `simulation-${tenantId}-${Date.now()}`,
              tenantId,
              logger: {
                info: (msg: string, ...args: unknown[]) => this.logger.log(msg, ...args),
                warn: (msg: string, ...args: unknown[]) => this.logger.warn(msg, ...args),
                error: (msg: string, ...args: unknown[]) => this.logger.error(msg, ...args),
                debug: (msg: string, ...args: unknown[]) => this.logger.debug(msg, ...args),
              }
            })
          : rawData;
    }

    const endTime = Date.now();
    const rawSizeBytes = JSON.stringify(rawData || {}).length;
    const finalSizeBytes = JSON.stringify(transformedData || {}).length;

    return {
        executionProfile: {
            latencyMs: endTime - startTime,
            rawSizeBytes,
            finalSizeBytes,
            compressionRatio: rawSizeBytes ? ((1 - (finalSizeBytes / rawSizeBytes)) * 100).toFixed(2) + '%' : '0%'
        },
        payload: transformedData,
    };
  }
}

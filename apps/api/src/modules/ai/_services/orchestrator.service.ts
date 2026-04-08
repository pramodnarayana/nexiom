import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { google } from '@ai-sdk/google';
import { streamText, dynamicTool, stepCountIs, type ModelMessage, convertToModelMessages, type UIMessage } from 'ai';
import { z } from 'zod';
import { eq, and, inArray } from 'drizzle-orm';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  DATABASE_CONNECTION,
  appConnections,
  safeAppConnectionColumns,
  AppConnectionStatus,
} from '@nexiom/database';
import type { DrizzleDb } from '@nexiom/database';
import { TokenManagerService } from '@nexiom/connectors';
import type { OAuthCredentialBlob } from '@nexiom/connectors';
import { PieceRegistryService } from '@nexiom/engine';
import { MetadataDiscoveryService } from '../../metadata/metadata-discovery.service.js';
import type { Piece } from '@nexiom/piece-framework';
import {
  AI_COPILOT_SYSTEM_PROMPT,
  AI_COPILOT_TOOL_INSTRUCTIONS,
} from '../_constants/prompts.js';

/** Maximum parallel related object fetch calls to prevent overwhelming external APIs */
const MAX_PARALLEL_RELATED_CALLS = 5;

/** Casts OAuthCredentialBlob to the generic Record the Piece interface expects. */
function toCredentialsRecord(
  credentials: OAuthCredentialBlob,
): Record<string, unknown> {
  return credentials as unknown as Record<string, unknown>;
}

interface ActiveConnection {
  id: string;
  appName: string;
  displayName: string;
}

/**
 * AI OrchestratorService — Production-Grade Hybrid Architecture
 *
 * On each chat request:
 *   1. Queries appConnections for only ACTIVE connections belonging to this org.
 *   2. For each active connection, resolves the piece from the registry.
 *   3. Fetches live credentials via TokenManagerService (handles refresh).
 *   4. Exposes two categories of tools per connection:
 *      a) `{app}_{connectionId}_getEntityWithRelations` — calls piece.describeRelatedObjects()
 *         to hydrate the full object graph in ONE parallel shot (no LLM chaining).
 *      b) One tool per action in the piece (create, update, delete mutations).
 *   5. Streams via Gemini with stopWhen: stepCountIs(5) to prevent runaway loops.
 */
@Injectable()
export class OrchestratorService {
  constructor(
    private readonly logger: PinoLogger,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly tokenManager: TokenManagerService,
    private readonly pieceRegistry: PieceRegistryService,
    private readonly metadataService: MetadataDiscoveryService,
  ) {
    this.logger.setContext(OrchestratorService.name);
  }

  async streamChat(
    messages: UIMessage[],
    tenantId: string,
    traceId: string,
  ): Promise<Response> {
    this.logger.info(
      { tenantId, traceId },
      'AI chat initiated — resolving active connections',
    );

    // ─── Step 1: Load only ACTIVE connections for this tenant ────────────────
    const activeConnections = await this.loadActiveConnections(tenantId);
    if (activeConnections.length === 0) {
      this.logger.warn(
        { tenantId, traceId },
        'No active connections found for tenant',
      );
      throw new BadRequestException(
        'No active app connections found. Please connect at least one app in Settings → Connections.',
      );
    }

    this.logger.info(
      { tenantId, traceId, apps: activeConnections.map((c) => c.appName) },
      'Active connections resolved',
    );

    // ─── Step 2: Build tool map scoped strictly to active connections ─────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: Record<string, any> = {};

    await Promise.all(
      activeConnections.map(async (conn) => {
        const piece = this.pieceRegistry.getPiece(conn.appName);
        if (!piece) {
          this.logger.warn(
            { traceId, appName: conn.appName },
            'Piece not registered for active connection — skipping',
          );
          return;
        }

        // Fetch credentials once per connection (handles token refresh internally)
        let credentials: OAuthCredentialBlob;
        try {
          credentials = await this.tokenManager.getValidCredentials(conn.id);
        } catch (err) {
          this.logger.warn(
            { traceId, connectionId: conn.id, appName: conn.appName, err },
            'Failed to fetch credentials — skipping connection tools',
          );
          return;
        }

        const creds = toCredentialsRecord(credentials);

        // Build both tool categories for this connection
        this.buildHydratorTool(tools, piece, conn, creds, traceId, tenantId);
        this.buildActionTools(tools, piece, conn, creds, traceId);
      }),
    );

    if (Object.keys(tools).length === 0) {
      throw new BadRequestException(
        'Unable to initialise AI tools. All connections may have expired credentials. Please re-authenticate.',
      );
    }

    this.logger.info(
      { traceId, toolCount: Object.keys(tools).length },
      'Tool context built — starting LLM stream',
    );

    // ─── Step 3: Stream via Gemini ────────────────────────────────────────────
    const modelMessages = await convertToModelMessages(messages);
    const result = streamText({
      model: google('gemini-2.5-flash'),
      messages: modelMessages,
      tools,
      // AI SDK v6: stopWhen replaces maxSteps. Prevents runaway LLM tool loops.
      stopWhen: stepCountIs(5),
      maxRetries: 0,
      system: `${AI_COPILOT_SYSTEM_PROMPT}\n\n${AI_COPILOT_TOOL_INSTRUCTIONS.replace('{{connections}}', activeConnections.map((_c, index) => `Connection ${index + 1}`).join(', '))}`,
      onFinish: (event) => {
        this.logger.info(
          { traceId, finishReason: event.finishReason, usage: event.usage },
          'Vercel AI SDK Stream cleanly finished.',
        );
      },
      onError: ({ error }) => {
        this.logger.error(
          { traceId, providerError: error },
          'Vercel AI SDK Provider catastrophically failed mid-stream!',
        );
      },
    });

    return result.toUIMessageStreamResponse({ originalMessages: messages });
  }

  // ─── Tool Category 1: Relationship-Aware Entity Hydrator ──────────────────
  // Uses piece.describeRelatedObjects() to discover and parallel-fetch ALL
  // related child/parent entities in one tool execution — no LLM chaining needed.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildHydratorTool(
    tools: Record<string, any>,
    piece: Piece,
    conn: ActiveConnection,
    creds: Record<string, unknown>,
    traceId: string,
    tenantId: string,
  ): void {
    if (typeof piece.describeRelatedObjects !== 'function') return;

    const toolName = `${conn.appName}_${conn.id}_getEntityWithRelations`;

    tools[toolName] = dynamicTool({
      description: [
        `Fetches a ${piece.displayName} entity AND ALL its related sub-entities`,
        `(e.g. Load + Stops + Line Items, Invoice + Line Items + Payments)`,
        `in a SINGLE call. Uses connection ${conn.id}.`,
        `Use this for ANY "give me details of X" or "show me X with everything" query.`,
      ].join(' '),
      inputSchema: z.object({
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
      }),
      execute: async ({ objectType, filters }) => {
        this.logger.info(
          { traceId, app: conn.appName, objectType, filters },
          'Hydrating entity with all relations',
        );

        try {
          this.logger.info(
            { traceId },
            'Step 1: Fetching metadata dictionary...',
          );
          const objects = await this.metadataService.describeObjects(
            tenantId,
            conn.id,
          );
          this.logger.info(
            { traceId, count: objects.length },
            'Step 1 complete: Metadata retrieved',
          );

          const tName = objectType.toLowerCase();
          let resolvedObjectName = objectType;
          let found = false;

          const match =
            objects.find((o) => o.name === objectType) ||
            objects.find((o) => o.label === objectType) ||
            objects.find(
              (o) =>
                o.name.toLowerCase() === tName ||
                o.label.toLowerCase() === tName,
            );

          if (match) {
            resolvedObjectName = match.name;
            found = true;
          } else {
            this.logger.warn(
              { traceId, objectType },
              'AI passed object type not found in Metadata Dictionary.',
            );
            return {
              connectionName: `connection-${conn.id}`,
              error: `Object type "${objectType}" not found in metadata dictionary. Please use a valid object type from the available metadata.`,
            };
          }

          this.logger.info(
            { traceId, resolvedObjectName, filters },
            'Step 2: Executing dynamic primary filter lookup...',
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let primaryResult: any = null;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
          if (!(piece as any).executeFind) {
            primaryResult = {
              error: `executeFind is not implemented natively on connection ${conn.appName}`,
            };
          } else {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
              const results = await (piece as any).executeFind(
                resolvedObjectName,
                filters,
                creds,
              );
              if (Array.isArray(results) && results.length > 0) {
                primaryResult = results[0]; // Take first match
              } else if (results && !Array.isArray(results)) {
                primaryResult = results;
              }
            } catch (e: unknown) {
              primaryResult = {
                error: `Failed to find ${resolvedObjectName}: ${(e as Error).message}`,
              };
            }
          }

          // Extract standard universal database primary key formats
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          const primaryId =
            primaryResult?.Id || primaryResult?.id || primaryResult?.internalId;

          if (!primaryResult || primaryResult.error || !primaryId) {
            this.logger.warn(
              { traceId, filters },
              'Primary record returned null, hit an error, or lacked an explicit ID to join. Short-circuiting payload.',
            );
            return {
              connectionName: `connection-${conn.id}`,
              error:
                primaryResult?.error ||
                `No records found in ${resolvedObjectName} matching filters ${JSON.stringify(filters)}. Cannot join relationship graph.`,
            };
          }

          this.logger.info(
            { traceId, resolvedObjectName },
            'Step 3: Describing related objects layer...',
          );
          const relatedObjects =
            await this.metadataService.describeRelatedObjects(
              tenantId,
              conn.id,
              resolvedObjectName,
            );
          this.logger.info(
            { traceId, count: relatedObjects.length },
            'Step 3 complete: Relationships discovered',
          );

          this.logger.info(
            { traceId, count: relatedObjects.length },
            'Step 4: Triggering robust concurrency-limited hydration graph for 1:N relations using resolved ID...',
          );

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const relatedResults: any[] = [];
          for (let i = 0; i < relatedObjects.length; i += MAX_PARALLEL_RELATED_CALLS) {
            const batch = relatedObjects.slice(i, i + MAX_PARALLEL_RELATED_CALLS);
            const batchResults = await Promise.all(
              batch.map(async (rel) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
                if (!(piece as any).executeFind) {
                  return {
                    objectType: rel.objectName,
                    relationshipType: rel.relationshipType,
                    records: [],
                    _note: 'executeFind not implemented on this piece',
                  };
                }

                try {
                  const filterProp = { [rel.relationField]: primaryId };
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
                  const records = await (piece as any).executeFind(
                    rel.objectName,
                    filterProp,
                    creds,
                  );
                  return {
                    objectType: rel.objectName,
                    relationshipType: rel.relationshipType,
                    records: Array.isArray(records) ? records : [records],
                  };
                } catch (e) {
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
          this.logger.info(
            { traceId },
            'Step 4 complete: Relationship graph extracted',
          );

          // --- ENTERPRISE PROMPT OPTIMIZATION ---
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
          const validRelations = relatedResults.filter(
            (r: any) => r && Array.isArray(r.records) && r.records.length > 0,
          );

          this.logger.info(
            {
              traceId,
              originalRelationsCount: relatedResults.length,
              prunedRelationsCount: validRelations.length,
            },
            'Step 5: Payload structurally pruned',
          );

          const rawPayload = {
            connectionName: `connection-${conn.id}`,
            [resolvedObjectName]: primaryResult,
            relations: Object.fromEntries(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
              validRelations.map((r: any) => [`${r.objectType}|${r.relationshipType}`, r]),
            ),
          };

          const finalPayload =
            this.optimizePayloadTokens(rawPayload) || rawPayload;

          this.logger.info(
            { traceId, payloadByteSize: JSON.stringify(finalPayload).length },
            'Step 6: Handing pristine resolved graph to Vercel AI SDK...',
          );
          return finalPayload;
        } catch (e) {
          this.logger.error(
            { traceId, app: conn.appName, objectType, filters, err: e },
            'Entity hydration failed',
          );
          throw e;
        }
      },
    });
  }

  // ─── Tool Category 2: Individual Action Tools (Mutations) ─────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildActionTools(
    tools: Record<string, any>,
    piece: Piece,
    conn: ActiveConnection,
    creds: Record<string, unknown>,
    traceId: string,
  ): void {
    for (const [actionName, action] of Object.entries(piece.actions || {})) {
      const toolName = `${conn.appName}_${conn.id}_${actionName}`.replace(
        /[^a-zA-Z0-9_-]/g,
        '_',
      );

      // Build typed zod schema from the action's property definitions
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, prop] of Object.entries(action.props || {})) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        const propType = (prop as any).type as string;
        let s: z.ZodTypeAny;
        if (['SHORT_TEXT', 'LONG_TEXT', 'SECRET_TEXT'].includes(propType))
          s = z.string();
        else if (propType === 'NUMBER') s = z.number();
        else if (propType === 'CHECKBOX') s = z.boolean();
        else if (propType === 'ARRAY') s = z.array(z.any());
        else s = z.any();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        if ((prop as any).description)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
          s = s.describe((prop as any).description as string);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        shape[key] = (prop as any).required ? s : s.optional();
      }

      // Add confirmation parameter to schema
      shape['confirmed'] = z
        .boolean()
        .optional()
        .describe('User confirmation required before executing this action');

      tools[toolName] = dynamicTool({
        description: [
          action.description || `Execute: ${action.displayName}`,
          `(via connection ${conn.id})`,
        ].join(' '),
        inputSchema: z.object(shape),
        execute: async (args) => {
          this.logger.info(
            { traceId, tool: toolName, connectionId: conn.id },
            'Executing action tool',
          );

          // TODO: Security Enhancement Required - Replace LLM-driven boolean confirmation
          // The current confirmed boolean check is fragile as the LLM can set it to true.
          // Implement a server-issued, single-use approval token flow:
          // 1. Create ApprovalTokenService to issue cryptographically secure tokens
          // 2. Frontend displays confirmation UI and requests approval token from backend
          // 3. Replace argsWithConfirm.confirmed with argsWithConfirm.approvalToken: string
          // 4. Validate token server-side (check user, conn/displayName, expiry, single-use)
          // 5. Invalidate token after verification to prevent replay attacks
          // 6. Return error if token missing/invalid, success only when token verified
          const argsWithConfirm = args as Record<string, unknown> & {
            confirmed?: boolean;
          };
          if (argsWithConfirm.confirmed !== true) {
            return {
              success: false,
              error:
                'Action requires explicit user confirmation. Please set confirmed=true to proceed.',
              connectionName: `connection-${conn.id}`,
            };
          }

          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            const result = await action.run({
              auth: creds,
              propsValue: args as any,
            });
            return {
              success: true,
              connectionName: `connection-${conn.id}`,
              data: result,
            };
          } catch (e) {
            this.logger.error(
              { traceId, tool: toolName, err: e },
              'Action tool execution failed',
            );
            return {
              success: false,
              error: `Action failed: ${(e as Error).message}`,
              connectionName: `connection-${conn.id}`,
            };
          }
        },
      });
    }
  }

  // ─── DB Helpers ───────────────────────────────────────────────────────────

  private async loadActiveConnections(
    tenantId: string,
  ): Promise<ActiveConnection[]> {
    const rows = await this.db
      .select({
        id: safeAppConnectionColumns.id,
        appName: safeAppConnectionColumns.appName,
        displayName: safeAppConnectionColumns.displayName,
      })
      .from(appConnections)
      .where(
        and(
          eq(appConnections.tenantId, tenantId),
          eq(appConnections.status, AppConnectionStatus.ACTIVE),
        ),
      );

    return rows;
  }

  // ─── Piece Helpers ────────────────────────────────────────────────────────

  /**
   * Finds the most relevant "get single record" action for a given object type.
   * Looks for actions whose name contains 'get' and the objectType name (case-insensitive).
   * Falls back to first action if no specific match found.
   */
  private resolveFetchAction(piece: Piece, objectType: string) {
    const actions = Object.values(piece.actions || {});
    const normalizedType = objectType.toLowerCase();

    // Prefer an action that looks like a "get by ID" for this type
    const match = actions.find(
      (a) =>
        a.name.toLowerCase().includes('get') &&
        (a.name.toLowerCase().includes(normalizedType) ||
          a.displayName.toLowerCase().includes(normalizedType)),
    );

    return match ?? null;
  }

  /**
   * Generatively prunes data structures, aggressively removing `null`, `undefined`,
   * or empty objects to drastically reduce LLM context token usage.
   * Caches standard URL tracking artifacts and UUID stamps typically not useful for generative insights.
   * Hard caps arrays to top 2 records to prevent 1:N relations from dominating context windows.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private optimizePayloadTokens(obj: any): any {
    if (obj === null || obj === undefined || obj === '') return undefined;
    if (typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      // Hard cap exactly to 2 records to prevent token explosions on 1:N graph traversals
      const sliced = obj.slice(0, 2);
      const cleanedArray = sliced
        .map((v) => this.optimizePayloadTokens(v))
        .filter((v) => v !== undefined);
      return cleanedArray.length > 0 ? cleanedArray : undefined;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pruned: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      // Drop enterprise system noise fields aggressively
      if (
        key === 'attributes' ||
        key === 'SystemModstamp' ||
        key === 'CreatedById' ||
        key === 'LastModifiedById' ||
        key === 'OwnerId' ||
        key === 'CurrencyIsoCode' ||
        key.toLowerCase() === 'url' ||
        key.startsWith('_')
      ) {
        continue;
      }

      let val = this.optimizePayloadTokens(obj[key]);

      // Truncate massively bloated string payloads
      if (typeof val === 'string' && val.length > 300) {
        val = val.substring(0, 300) + '...[TRUNC]';
      }
      if (val !== undefined) {
        // If it's an object and completely empty after pruning, don't include it
        if (typeof val === 'object' && Object.keys(val).length === 0) {
          continue;
        }
        pruned[key] = val;
      }
    }

    return Object.keys(pruned).length > 0 ? pruned : undefined;
  }
}
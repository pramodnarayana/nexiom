import { Injectable, Inject, BadRequestException, Logger } from '@nestjs/common';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { anthropic } from '@ai-sdk/anthropic';
import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from 'ai';
import { eq, and } from 'drizzle-orm';
import { DATABASE_CONNECTION, dataSources, credentials, AppConnectionStatus } from '@nexiom/database';
import type { DrizzleDb } from '@nexiom/database';
import { TokenManagerService } from '@nexiom/credentials';
import { PieceRegistryService } from '@nexiom/piece-registry';
import { HydratorToolFactory } from '../tools/hydrator-tool.factory.js';
import { ActionToolFactory } from '../tools/action-tool.factory.js';
import { IntentClassifierService } from '../planner/intent-classifier.service.js';
import { AI_COPILOT_SYSTEM_PROMPT, AI_COPILOT_TOOL_INSTRUCTIONS } from '../contracts/prompts.js';
import type { OAuthCredentialBlob } from '@nexiom/credentials';

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly tokenManager: TokenManagerService,
    private readonly pieceRegistry: PieceRegistryService,
    private readonly hydratorFactory: HydratorToolFactory,
    private readonly actionFactory: ActionToolFactory,
    private readonly intentClassifier: IntentClassifierService,
    @Inject('REDIS_CLIENT') private readonly redis?: any,
  ) {}

  async streamChat(messages: UIMessage[], tenantId: string, traceId: string, requestedModel?: string): Promise<Response> {
    this.logger.log(`[${traceId}] AI chat initiated — resolving active connections`);

    const activeConnections = await this.loadActiveConnections(tenantId);
    if (activeConnections.length === 0) {
      throw new BadRequestException('No active app connections found. Please connect an app.');
    }

    const intent = await this.intentClassifier.classifyIntent(messages, activeConnections, traceId);

    // Broadcast Intent Payload Event securely
    if (this.redis) {
      const payloadObj = {
        type: 'step',
        data: {
          message: 'Intent classified',
          details: `Targeting apps: ${activeConnections.filter(c => intent.targetedConnectionIds?.includes(c.id)).map(c => c.appName).join(', ')}`
        }
      };
      // Vercel AI Data Stream format for custom data is `8:` or `9:` (Data stream or Error).
      // We will send custom messages as raw parsed JSON objects if the client handles it, or as `2:` stream chunks?
      // Since this is native text stream bridge, let's just publish `8:` (Data Part in Vercel Stream).
      await this.redis.publish(`job:stream:${traceId}`, `8:${JSON.stringify([payloadObj])}\n`);
    }

    if (!intent.targetedConnectionIds || intent.targetedConnectionIds.length === 0) {
      return new Response(
        'I am a Domain-specific SaaS Copilot. Your request falls outside of the scope of your connected applications. Please ask me about records from ' +
          activeConnections.map((c) => c.appName).join(', '),
        { status: 400 }
      );
    }

    const filteredConnections = activeConnections.filter((c) => intent.targetedConnectionIds.includes(c.id));
    const tools: Record<string, any> = {};

    await Promise.all(
      filteredConnections.map(async (conn) => {
        const piece = this.pieceRegistry.getPiece(conn.appName);
        if (!piece) return;

        let credentials: OAuthCredentialBlob;
        try {
          credentials = await this.tokenManager.getValidCredentials(conn.id);
        } catch {
          return;
        }

        const creds = credentials as unknown as Record<string, unknown>;

        this.hydratorFactory.buildHydratorTool(tools, piece, conn, creds, traceId, tenantId);
        this.actionFactory.buildActionTools(tools, piece, conn, creds, traceId);
      }),
    );

    if (Object.keys(tools).length === 0) {
      throw new BadRequestException('Unable to initialise AI tools. Connections may have expired credentials.');
    }

    let modelMessages = await convertToModelMessages(messages);

    const userMessageIndices = modelMessages.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i !== -1);
    if (userMessageIndices.length > 2) {
        // truncate to save memory
      const cutoffIndex = userMessageIndices[userMessageIndices.length - 2];
      modelMessages = modelMessages.slice(cutoffIndex);
    }

    const systemPrompt = `${AI_COPILOT_SYSTEM_PROMPT}\n\n${AI_COPILOT_TOOL_INSTRUCTIONS.replace(
      '{{connections}}',
      filteredConnections.map((_c, index) => `Connection ${index + 1}`).join(', ')
    )}`;

    // Resolve Provider
    let llmModel;
    if (requestedModel?.includes('gemini')) {
       llmModel = google(requestedModel);
    } else if (requestedModel?.includes('claude')) {
       llmModel = anthropic(requestedModel);
    } else {
       llmModel = openai(requestedModel || 'gpt-4o');
    }

    const result = streamText({
      model: llmModel,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(5),
      maxRetries: 0,
      system: systemPrompt,
      onFinish: (event) => {
        this.logger.log(`[${traceId}] Vercel AI SDK Stream cleanly finished.`);
      },
      onError: ({ error }) => {
        this.logger.error(`[${traceId}] Provider catastrophically failed mid-stream!`, error);
      },
    });

    return result.toUIMessageStreamResponse({ originalMessages: messages });
  }

  private async loadActiveConnections(tenantId: string) {
    return this.db.select({
      id: dataSources.id,
      appName: dataSources.appName,
      displayName: dataSources.displayName,
    }).from(dataSources).innerJoin(credentials, eq(credentials.dataSourceId, dataSources.id)).where(
      and(eq(dataSources.tenantId, tenantId), eq(credentials.status, AppConnectionStatus.ACTIVE))
    );
  }
}

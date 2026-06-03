import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  Req,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@soopa/auth';
import { AiRateLimitGuard } from '../interceptors/ai-ratelimit.guard.js';
import { AiTelemetryInterceptor } from '../interceptors/ai-telemetry.interceptor.js';
import {
  OrchestratorService,
  ChatRequest,
  ChatPersistenceService,
} from '@soopa/ai-engine';
import { QueueName, QUEUE_SERVICE } from '@soopa/queue';
import type { IQueueService } from '@soopa/queue';
import { PinoLogger } from 'nestjs-pino';
import { Inject } from '@nestjs/common';

@Controller('ai')
export class AiController {
  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly chatPersistence: ChatPersistenceService,
    @Inject(QUEUE_SERVICE) private readonly queueService: IQueueService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AiController.name);
  }

  /**
   * POST /api/v1/ai/chat
   *
   * Accepts the standard Vercel AI SDK `messages` array from the frontend
   * `useChat` hook. Resolves the tenant's active OAuth connections, builds a
   * scoped tool context, and streams the response via Gemini + Vercel streamText.
   */
  @Post('chat')
  @UseGuards(AuthGuard, AiRateLimitGuard)
  @UseInterceptors(AiTelemetryInterceptor)
  async chat(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    body: ChatRequest,
    @Req()
    req: Request & {
      user?: { organizationId?: string; tenantId?: string };
      traceId?: string;
    },
  ) {
    const tenantId: string =
      req.user?.organizationId ?? req.user?.tenantId ?? 'anonymous';
    const traceId: string = req.traceId ?? 'unknown';

    // Grab the last message to derive summary or extract content
    const rawLatestMessage = body.messages[body.messages.length - 1] as unknown;
    const latestMessage = rawLatestMessage as
      | { role: string; content: string }
      | undefined;

    // Safely sync conversation initialization
    const conversation = await this.chatPersistence.getOrCreateConversation(
      tenantId,
      body.conversationId,
      latestMessage?.content?.substring(0, 50) || 'New AI Request',
    );

    if (latestMessage && latestMessage.role === 'user') {
      await this.chatPersistence.appendMessage({
        tenantId,
        conversationId: conversation.id,
        role: 'user',
        content: latestMessage.content,
        status: 'completed',
      });
    }

    const jobId = randomUUID();

    // Send payload to the AI Copilot async pipeline
    await this.queueService.send(QueueName.AiCopilotQueue, {
      jobId,
      traceId,
      tenantId,
      conversationId: conversation.id,
      messages: body.messages,
      model: body.model,
    });

    this.logger.info(`Offloaded chat request to queue. Job: ${jobId}`);

    // Return the handle for the Realtime UX to subscribe via SSE
    return {
      success: true,
      jobId,
      conversationId: conversation.id,
    };
  }

  /**
   * GET /api/v1/ai/conversations
   * Retrieves all historical conversations for the current tenant.
   */
  @Get('conversations')
  @UseGuards(AuthGuard)
  async listConversations(
    @Req()
    req: Request & {
      user?: { organizationId?: string; tenantId?: string };
    },
  ) {
    const tenantId: string =
      req.user?.organizationId ?? req.user?.tenantId ?? 'anonymous';
    const conversations =
      await this.chatPersistence.listConversations(tenantId);
    return { success: true, data: conversations };
  }

  /**
   * GET /api/v1/ai/conversations/:id/messages
   * Retrieves the full human-readable lineage of a specific conversation.
   */
  @Get('conversations/:id/messages')
  @UseGuards(AuthGuard)
  async getConversationMessages(
    @Param('id') conversationId: string,
    @Req()
    req: Request & {
      user?: { organizationId?: string; tenantId?: string };
    },
  ) {
    const tenantId: string =
      req.user?.organizationId ?? req.user?.tenantId ?? 'anonymous';
    const messages = await this.chatPersistence.getLineage(
      tenantId,
      conversationId,
    );
    return { success: true, data: messages };
  }
}

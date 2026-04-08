import { Readable, pipeline } from 'node:stream';
import type { Request, Response } from 'express';
import {
  Controller,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  Req,
  Res,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nexiom/auth';
import { AiRateLimitGuard } from '../_interceptors/ai-ratelimit.guard.js';
import { AiTelemetryInterceptor } from '../_interceptors/ai-telemetry.interceptor.js';
import { OrchestratorService } from '../_services/orchestrator.service.js';
import { ChatRequest } from '../_types/chat-request.types.js';
import type { UIMessage } from 'ai';
import { PinoLogger } from 'nestjs-pino';

@Controller('ai')
export class AiController {
  constructor(
    private readonly orchestrator: OrchestratorService,
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
    @Res() res: Response,
  ) {
    const tenantId: string =
      req.user?.organizationId ?? req.user?.tenantId ?? 'anonymous';
    const traceId: string = req.traceId ?? 'unknown';

    const webResponse = await this.orchestrator.streamChat(
      body.messages as unknown as UIMessage[],
      tenantId,
      traceId,
    );

    // Express Socket Bridging
    res.status(webResponse.status || 200);
    webResponse.headers?.forEach((value: string, key: string) => {
      res.setHeader(key, value);
    });

    if (webResponse.body) {
      // Use native Node.js web stream mapping to guarantee flawless chunk flushing and backpressure
      // @ts-expect-error Ignore type mismatch between Web stream and Node stream
      pipeline(Readable.fromWeb(webResponse.body), res, (err) => {
        if (err) {
          this.logger.error('stream error', err);
        }
      });
    } else {
      res.end();
    }
  }
}
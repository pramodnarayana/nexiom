import { Controller, Param, Sse, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '@nexiom/auth';
import type { Redis } from 'ioredis';
import { Observable } from 'rxjs';
import { PinoLogger } from 'nestjs-pino';

// We import the token directly from local cache module constants or simply use the string
const REDIS_CLIENT = 'REDIS_CLIENT';

@Controller('ai/jobs')
export class AiStreamController {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AiStreamController.name);
  }

  /**
   * GET /api/v1/ai/jobs/:jobId/stream
   *
   * Subscribes to the async CopilotWorker's Redis channel for this specific job
   * and pushes Vercel AI streaming chunks directly to the frontend via SSE.
   */
  @Sse(':jobId/stream')
  @UseGuards(AuthGuard)
  streamJob(@Param('jobId') jobId: string): Observable<{ data: string }> {
    return new Observable((subscriberFn) => {
      // Note: Job ownership validation should be added here in the future
      // by fetching job metadata and comparing tenant/owner to the authenticated user
      // before subscribing to the Redis channel.

      // ioredis mutating subscriber client - must be duplicated for thread safety
      const subscriber = this.redisClient.duplicate();
      const channel = `job:stream:${jobId}`;

      void subscriber.subscribe(channel, (err) => {
        if (err) {
          this.logger.error(`Failed to subscribe to ${channel}`, err);
          subscriberFn.error(err);
        } else {
          this.logger.debug(`Subscribed to SSE channel ${channel}`);
        }
      });

      subscriber.on('message', (receivedChannel, message) => {
        if (receivedChannel === channel) {
          // Forward chunk to Vercel AI useChat hook.
          // Note: NestJS @Sse() automatically formats the object returned into:
          // `data: ${message}\n\n` securely over the socket.
          subscriberFn.next({ data: message });

          // Terminate gracefully when Vercel stream signals completion
          // Use exact match to prevent false positives
          if (message.trim() === '[DONE]') {
            this.logger.debug(`Job ${jobId} finished. Closing SSE stream.`);
            subscriber.unsubscribe(channel).catch(() => {});
            subscriber.quit().catch(() => {});
            subscriberFn.complete();
          }
        }
      });

      // Cleanup when the HTTP client forcibly disconnects or times out
      return () => {
        this.logger.debug(`Client disconnected from ${channel}`);
        subscriber.unsubscribe(channel).catch(() => {});
        subscriber.quit().catch(() => {});
      };
    });
  }
}

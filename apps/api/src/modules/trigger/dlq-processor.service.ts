import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Redis } from 'ioredis';
import {
  TriggerExecutorService,
  type TriggerRunParams,
} from './trigger-executor.service';
import { PieceRegistryService } from './piece-registry.service';

const MAX_ATTEMPTS = 3;
const DLQ_KEY = 'dlq:triggers';

interface DlqJob {
  appName: string;
  triggerName: string;
  workspaceId: string;
  objectType?: string;
  propsValue: Record<string, unknown>;
  auth: unknown;
  failedAt: string;
  error: string;
  attempt: number;
}

/**
 * Dead-Letter Queue processor.
 *
 * Runs every minute. Drains up to 50 jobs from the dlq:triggers Redis list,
 * retrying each with exponential backoff. Jobs that exhaust MAX_ATTEMPTS are
 * moved to dlq:triggers:failed for human inspection.
 */
@Injectable()
export class DlqProcessorService {
  private readonly logger = new Logger(DlqProcessorService.name);
  private readonly BATCH_SIZE = 50;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly executor: TriggerExecutorService,
    private readonly pieceRegistry: PieceRegistryService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processDlq(): Promise<void> {
    for (let i = 0; i < this.BATCH_SIZE; i++) {
      const raw = await this.redis.rpop(DLQ_KEY);
      if (!raw) break;

      let job: DlqJob;
      try {
        job = JSON.parse(raw) as DlqJob;
      } catch {
        this.logger.error('DLQ job could not be parsed — discarding', { raw });
        continue;
      }

      const trigger = this.pieceRegistry.getTrigger(
        job.appName,
        job.triggerName,
      );
      if (!trigger) {
        this.logger.warn('DLQ job references unknown trigger — discarding', {
          appName: job.appName,
          triggerName: job.triggerName,
        });
        continue;
      }

      // Exponential backoff sleep before retry
      const delay = Math.pow(2, job.attempt) * 1000;
      await new Promise((res) => setTimeout(res, delay));

      try {
        const params: TriggerRunParams = {
          trigger,
          appName: job.appName,
          triggerName: job.triggerName,
          objectType: job.objectType,
          auth: job.auth,
          propsValue: job.propsValue,
          workspaceId: job.workspaceId,
        };
        await this.executor.runPoll(params);
        this.logger.log('DLQ job retried successfully', {
          appName: job.appName,
          triggerName: job.triggerName,
          attempt: job.attempt,
        });
      } catch (err) {
        const nextAttempt = job.attempt + 1;
        if (nextAttempt >= MAX_ATTEMPTS) {
          const failed = JSON.stringify({
            ...job,
            exhaustedAt: new Date().toISOString(),
          });
          await this.redis.lpush(`${DLQ_KEY}:failed`, failed);
          this.logger.error(
            'DLQ job exhausted retries — moved to failed list',
            {
              appName: job.appName,
              triggerName: job.triggerName,
            },
          );
        } else {
          const retryJob = JSON.stringify({
            ...job,
            attempt: nextAttempt,
            error: err instanceof Error ? err.message : String(err),
          });
          await this.redis.lpush(DLQ_KEY, retryJob);
          this.logger.warn(
            `DLQ job failed (attempt ${nextAttempt}/${MAX_ATTEMPTS}) — re-queued`,
            {
              appName: job.appName,
              triggerName: job.triggerName,
            },
          );
        }
      }
    }
  }
}

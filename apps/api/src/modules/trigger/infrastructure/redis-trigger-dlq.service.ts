import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ITriggerDlqService } from '../interfaces/trigger-dlq.interface.js';

const DLQ_KEY = 'dlq:triggers';
const DLQ_PROCESSING_KEY = 'dlq:triggers:processing';
const DLQ_DELAYED_KEY = 'dlq:triggers:delayed';
const DLQ_FAILED_KEY = 'dlq:triggers:failed';

@Injectable()
export class RedisTriggerDlqService implements ITriggerDlqService {
  private readonly logger = new Logger(RedisTriggerDlqService.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async pushJob(jobPayload: string): Promise<void> {
    await this.redis.lpush(DLQ_KEY, jobPayload);
  }

  async promoteDelayedJobs(batchSize: number): Promise<number> {
    const now = Date.now();

    const LUA_PROMOTE = [
      'local members = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", ARGV[1], "LIMIT", 0, ARGV[2])',
      'if #members > 0 then',
      '  for _, m in ipairs(members) do',
      '    redis.call("LPUSH", KEYS[2], m)',
      '    redis.call("ZREM", KEYS[1], m)',
      '  end',
      'end',
      'return #members',
    ].join('\n');

    const promoted = (await this.redis.eval(
      LUA_PROMOTE,
      2,
      DLQ_DELAYED_KEY,
      DLQ_KEY,
      String(now),
      String(batchSize),
    )) as number;

    return promoted;
  }

  async reclaimStaleJobs(staleMs: number, batchSize: number): Promise<number> {
    const staleThreshold = Date.now() - staleMs;

    const LUA_RECLAIM_BATCH = [
      'local reclaimed = 0',
      'local maxItems = tonumber(ARGV[2])',
      'for i = 1, maxItems do',
      '  local item = redis.call("LINDEX", KEYS[1], -1)',
      '  if not item then break end',
      '  local ok, parsed = pcall(cjson.decode, item)',
      '  if not ok then',
      '    redis.call("RPOP", KEYS[1])',
      '  elseif parsed.processingStartedAt and parsed.processingStartedAt <= tonumber(ARGV[1]) then',
      '    redis.call("RPOPLPUSH", KEYS[1], KEYS[2])',
      '    reclaimed = reclaimed + 1',
      '  else',
      '    break',
      '  end',
      'end',
      'return reclaimed',
    ].join('\n');

    const reclaimed = (await this.redis.eval(
      LUA_RECLAIM_BATCH,
      2,
      DLQ_PROCESSING_KEY,
      DLQ_KEY,
      String(staleThreshold),
      String(batchSize),
    )) as number;

    return reclaimed;
  }

  async drainReadyJobs(
    batchSize: number,
    handler: (raw: string) => Promise<void>,
  ): Promise<void> {
    const LUA_DRAIN = [
      'local item = redis.call("RPOP", KEYS[1])',
      'if not item then return nil end',
      'local ok, parsed = pcall(cjson.decode, item)',
      'if ok then',
      '  parsed.processingStartedAt = tonumber(ARGV[1])',
      '  item = cjson.encode(parsed)',
      'end',
      'redis.call("LPUSH", KEYS[2], item)',
      'return item',
    ].join('\n');

    for (let i = 0; i < batchSize; i++) {
      const raw = (await this.redis.eval(
        LUA_DRAIN,
        2,
        DLQ_KEY,
        DLQ_PROCESSING_KEY,
        String(Date.now()),
      )) as string | null;
      if (!raw) break;

      await handler(raw);
    }
  }

  async scheduleDelayedRetry(
    raw: string,
    retryPayload: string,
    delayMs: number,
  ): Promise<void> {
    // Use Lua script to atomically LREM and ZADD
    const script = `
      local removed = redis.call('LREM', KEYS[1], 1, ARGV[1])
      if removed > 0 then
        redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3])
      end
      return removed
    `;
    await this.redis.eval(
      script,
      2,
      DLQ_PROCESSING_KEY,
      DLQ_DELAYED_KEY,
      raw,
      Date.now() + delayMs,
      retryPayload,
    );
  }

  async markJobFailed(raw: string, failedPayload: string): Promise<void> {
    // Use Lua script to atomically LREM and LPUSH
    const script = `
      local removed = redis.call('LREM', KEYS[1], 1, ARGV[1])
      if removed > 0 then
        redis.call('LPUSH', KEYS[2], ARGV[2])
      end
      return removed
    `;
    await this.redis.eval(
      script,
      2,
      DLQ_PROCESSING_KEY,
      DLQ_FAILED_KEY,
      raw,
      failedPayload,
    );
  }

  async acknowledgeJob(raw: string): Promise<void> {
    await this.redis.lrem(DLQ_PROCESSING_KEY, 1, raw);
  }

  async removeUnparseableJob(raw: string): Promise<void> {
    await this.redis.lrem(DLQ_PROCESSING_KEY, 1, raw);
  }
}

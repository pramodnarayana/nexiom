import type { Request, Response } from 'express';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Inject,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { REDIS_CLIENT, type Redis } from '@nexiom/cache';

/** Fixed window: 30 streaming requests per user per 60 seconds. */
const LIMIT = 30;
const WINDOW_SECONDS = 60;

/**
 * AiRateLimitGuard — atomic fixed-window token bucket for the /chat endpoint.
 *
 * Uses the same Lua-script pattern as TenantRateLimitGuard to guarantee
 * atomic check-then-increment. Scoped per authenticated user ID so multi-tenant
 * usage is isolated and the LLM billing exposure is bounded per user.
 *
 * Returns 429 with `Retry-After` header when the bucket is exhausted.
 */
@Injectable()
export class AiRateLimitGuard implements CanActivate {
  // Lua: check-before-increment so the counter never overshoots LIMIT.
  // Returns remaining TTL (>=0) when exhausted; -1 when allowed.
  private static readonly LUA_SCRIPT = [
    'local current = redis.call("GET", KEYS[1])',
    'if current and tonumber(current) >= tonumber(ARGV[1]) then',
    '  local ttl = redis.call("TTL", KEYS[1])',
    '  if ttl < 0 then',
    '    redis.call("EXPIRE", KEYS[1], ARGV[2])',
    '    ttl = tonumber(ARGV[2])',
    '  end',
    '  return ttl',
    'end',
    'local new = redis.call("INCR", KEYS[1])',
    'if new == 1 then',
    '  redis.call("EXPIRE", KEYS[1], ARGV[2])',
    'end',
    'return -1',
  ].join('\n');

  constructor(
    private readonly logger: PinoLogger,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.logger.setContext(AiRateLimitGuard.name);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: { id?: string } }>();
    const res = context.switchToHttp().getResponse<Response>();
    const userId: string = req.user?.id ?? req.ip ?? 'anonymous';

    const key = `ratelimit:ai:chat:${userId}`;

    let result: unknown;
    try {
      result = await this.redis.eval(
        AiRateLimitGuard.LUA_SCRIPT,
        1,
        key,
        String(LIMIT),
        String(WINDOW_SECONDS),
      );
    } catch (err) {
      this.logger.warn({ userId, err }, 'AI chat rate limit check failed');
      // Degrade gracefully: allow the request to proceed
      return true;
    }

    if (result !== -1) {
      const retryAfter = typeof result === 'number' ? result : WINDOW_SECONDS;
      res.setHeader('Retry-After', String(retryAfter));
      this.logger.warn({ userId, retryAfter }, 'AI chat rate limit exceeded');
      throw new HttpException(
        `AI rate limit exceeded. Please wait ${retryAfter} seconds before sending another message.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { REDIS_CLIENT, type Redis } from '@nexiom/cache';
import { DATABASE_CONNECTION, appConnections } from '@nexiom/database';
import type { DrizzleDb } from '@nexiom/database';
import { eq } from 'drizzle-orm';

/** Default request allowance per tenant per 60-second window. */
const DEFAULT_LIMIT = 1_000;
/** Window duration in seconds. */
const WINDOW_SECONDS = 60;

/** RFC 4122 UUID regex — guards run before ParseUUIDPipe so we validate here. */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Key used to cache the resolved connection on the Express request object.
 * WebhookSignatureGuard reads this to avoid a second DB round-trip.
 */
export const WEBHOOK_RESOLVED_CONNECTION = 'webhookResolvedConnection' as const;

/** Connection fields resolved once per request and shared with downstream guards. */
export interface WebhookResolvedConnection {
  tenantId: string;
  appName: string;
  metadata: unknown;
}

/**
 * TenantRateLimitGuard -- fixed-window token bucket per tenant.
 *
 * Redis key: `ratelimit:l1:{tenantId}`
 * TTL: 60 seconds (resets the bucket each minute).
 *
 * Enterprise tenants can have a higher limit stored in
 * `app_connection.metadata.rateLimitPerMin` (JSON number).
 *
 * Returns 429 with `Retry-After` header when the bucket is exhausted.
 *
 * Side-effect: attaches the resolved connection to `req[WEBHOOK_RESOLVED_CONNECTION]`
 * so WebhookSignatureGuard can read it without a second DB query.
 *
 * Probe protection:
 *  - Malformed UUIDs are rejected before hitting the DB; a shared fallback
 *    bucket (`ratelimit:l1:probe`) throttles probe bursts.
 *  - Well-formed but unknown UUIDs receive a per-connection fallback bucket
 *    (`ratelimit:l1:probe:{connectionId}`) before the 404 is returned.
 */
@Injectable()
export class TenantRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(TenantRateLimitGuard.name);

  // Lua script: check-before-increment so the counter never grows beyond
  // the limit, keeping metrics accurate and X-RateLimit-Remaining correct.
  //
  // TTL normalisation: if the bucket key somehow lost its expiry (TTL = -1),
  // re-apply the window before returning so rate limiting never fails open.
  //
  // Returns the remaining TTL (seconds, >= 0) when the bucket is exhausted,
  // -1 when the request is allowed.
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
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<
        Request & { [WEBHOOK_RESOLVED_CONNECTION]?: WebhookResolvedConnection }
      >();
    const res = context.switchToHttp().getResponse<Response>();
    const connectionId = req.params['connectionId'];

    // Guards execute before ParseUUIDPipe — validate format here so malformed
    // IDs never reach the database.
    if (!UUID_REGEX.test(connectionId)) {
      await this.applyFallbackRateLimit(res, 'ratelimit:l1:probe');
      throw new BadRequestException(
        `Invalid connectionId format: "${connectionId}"`,
      );
    }

    const [conn] = await this.db
      .select({
        tenantId: appConnections.tenantId,
        appName: appConnections.appName,
        metadata: appConnections.metadata,
      })
      .from(appConnections)
      .where(eq(appConnections.id, connectionId))
      .limit(1);

    if (!conn) {
      // Apply a per-connection fallback bucket to throttle enumeration probes
      // without revealing tenant information.
      await this.applyFallbackRateLimit(
        res,
        `ratelimit:l1:probe:${connectionId}`,
      );
      throw new NotFoundException(`Connection ${connectionId} not found`);
    }

    // Cache on the request so WebhookSignatureGuard skips a second DB round-trip.
    req[WEBHOOK_RESOLVED_CONNECTION] = {
      tenantId: conn.tenantId,
      appName: conn.appName,
      metadata: conn.metadata,
    };

    const limit = resolveLimit(conn.metadata);
    const key = `ratelimit:l1:${conn.tenantId}`;

    await this.checkRateLimit(res, key, limit, conn.tenantId);

    return true;
  }

  /**
   * Evaluates the Lua rate-limit script for a known tenant.
   * Throws 429 with Retry-After if the bucket is exhausted.
   */
  private async checkRateLimit(
    res: Response,
    key: string,
    limit: number,
    tenantId: string,
  ): Promise<void> {
    const result = await this.redis.eval(
      TenantRateLimitGuard.LUA_SCRIPT,
      1,
      key,
      String(limit),
      String(WINDOW_SECONDS),
    );

    if (result !== -1) {
      const retryAfter = typeof result === 'number' ? result : WINDOW_SECONDS;
      // Express does not clear headers when the exception filter subsequently
      // calls res.status(429).json(...) — previously-set headers are preserved.
      res.setHeader('Retry-After', String(retryAfter));
      this.logger.warn(
        `Rate limit exceeded: tenantId=${tenantId} limit=${limit}/min retryAfter=${retryAfter}s`,
      );
      throw new HttpException(
        `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Applies the rate-limit script to a fallback key (malformed or unknown IDs).
   * Throws 429 if exhausted; otherwise returns silently.
   */
  private async applyFallbackRateLimit(
    res: Response,
    key: string,
  ): Promise<void> {
    const result = await this.redis.eval(
      TenantRateLimitGuard.LUA_SCRIPT,
      1,
      key,
      String(DEFAULT_LIMIT),
      String(WINDOW_SECONDS),
    );

    if (result !== -1) {
      const retryAfter = typeof result === 'number' ? result : WINDOW_SECONDS;
      res.setHeader('Retry-After', String(retryAfter));
      this.logger.warn(
        `Probe rate limit exceeded: key=${key} retryAfter=${retryAfter}s`,
      );
      throw new HttpException(
        `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

/**
 * Resolves the per-tenant request limit.
 * Enterprise tenants can store `rateLimitPerMin` in the connection metadata.
 * Falls back to DEFAULT_LIMIT for standard tenants.
 */
function resolveLimit(metadata: unknown): number {
  if (
    typeof metadata === 'object' &&
    metadata !== null &&
    'rateLimitPerMin' in metadata
  ) {
    const custom = (metadata as Record<string, unknown>)['rateLimitPerMin'];
    if (typeof custom === 'number' && custom > 0) return custom;
  }
  return DEFAULT_LIMIT;
}

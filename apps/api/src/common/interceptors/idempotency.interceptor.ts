import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  ConflictException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import {
  IDEMPOTENT_KEY,
  IdempotencyOptions,
} from '../decorators/idempotent.decorator.js';
import { REDIS_CLIENT, type Redis } from '@soopa/cache';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const options = this.reflector.get<IdempotencyOptions>(
      IDEMPOTENT_KEY,
      context.getHandler(),
    );

    if (!options) {
      return next.handle();
    }

    const args = context.getArgs<unknown[]>();
    let keyStr = '';

    if (options.keyResolver) {
      keyStr = options.keyResolver(...args);
    } else if (
      options.keyIndex !== undefined &&
      args.length > options.keyIndex &&
      args[options.keyIndex] !== undefined &&
      args[options.keyIndex] !== null
    ) {
      keyStr = String(args[options.keyIndex]);
    } else {
      const request = context.switchToHttp().getRequest<{
        headers: Record<string, string | string[] | undefined>;
      }>();
      const headerValue = request.headers['x-idempotency-key'];
      if (Array.isArray(headerValue)) {
        keyStr = headerValue[0] ? String(headerValue[0]).trim() : '';
      } else if (headerValue) {
        keyStr = String(headerValue).trim();
      } else {
        keyStr = '';
      }
    }

    if (!keyStr) {
      return next.handle();
    }

    const cacheKey = `idempotent:${context.getClass().name}:${context.getHandler().name}:${keyStr}`;
    const ttl = options.ttlSeconds || 86400; // default 24h

    const existing = await this.redis.get(cacheKey);
    if (existing) {
      if (existing === 'PROCESSING') {
        throw new ConflictException('Request is currently being processed');
      }
      try {
        const parsed = JSON.parse(existing) as unknown;
        return of(parsed);
      } catch {
        return of(existing);
      }
    }

    const acquired = await this.redis.setnx(cacheKey, 'PROCESSING');
    if (!acquired) {
      throw new ConflictException('Request is currently being processed');
    }
    await this.redis.expire(cacheKey, ttl);

    return next.handle().pipe(
      tap((response: unknown) => {
        const responseData =
          typeof response === 'string' ? response : JSON.stringify(response);
        void this.redis.set(cacheKey, responseData, 'EX', ttl);
      }),
      catchError((error: unknown) => {
        void this.redis.del(cacheKey);
        throw error;
      }),
    );
  }
}

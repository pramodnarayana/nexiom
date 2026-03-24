import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

/**
 * Guards the /internal/scheduler/execute-stitch endpoint.
 *
 * Validates that the incoming request carries `Authorization: Bearer <WINDMILL_INTERNAL_SECRET>`.
 * Uses a constant-time comparison to prevent timing-based secret extraction.
 *
 * Returns 401 if:
 *   - The Authorization header is absent.
 *   - The scheme is not "Bearer".
 *   - The token does not match WINDMILL_INTERNAL_SECRET.
 */
@Injectable()
export class InternalSchedulerGuard implements CanActivate {
  /** Pre-computed SHA-256 digest of the expected secret. Computed once at construction. */
  private readonly expectedDigest: Buffer;

  constructor(config: ConfigService) {
    // Read and hash the secret once at startup. This avoids a ConfigService
    // call in the hot path and ensures a missing config key fails fast at boot,
    // not at request time (which would throw a non-UnauthorizedException error).
    const secret = config.getOrThrow<string>('WINDMILL_INTERNAL_SECRET');
    this.expectedDigest = createHash('sha256').update(secret).digest();
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid Authorization header',
      );
    }

    const token = authHeader.slice(7);

    // Hash both values to a fixed-length digest before comparing.
    // This prevents leaking the secret length via the early-exit length check
    // that a direct Buffer comparison would require.
    const tokenDigest = createHash('sha256').update(token).digest();

    if (!timingSafeEqual(tokenDigest, this.expectedDigest)) {
      throw new UnauthorizedException('Invalid internal scheduler secret');
    }

    return true;
  }
}

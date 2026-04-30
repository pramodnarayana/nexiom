import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * Guards the POST /internal/gitops/sync endpoint.
 *
 * Validates that the incoming request carries:
 *   Authorization: Bearer <GITOPS_WEBHOOK_SECRET>
 *
 * Uses a constant-time comparison to prevent timing-based secret extraction.
 * Register GITOPS_WEBHOOK_SECRET in GitHub/GitLab as the webhook secret.
 *
 * Returns 401 if:
 *   - The Authorization header is absent or not a Bearer token.
 *   - The token does not match GITOPS_WEBHOOK_SECRET.
 */
@Injectable()
export class GitopsWebhookGuard implements CanActivate {
  /** Pre-computed SHA-256 digest of the expected secret. Computed once at construction. */
  private readonly expectedDigest: Buffer;

  constructor(config: ConfigService) {
    const secret = config.getOrThrow<string>('GITOPS_WEBHOOK_SECRET');
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
    const tokenDigest = createHash('sha256').update(token).digest();

    if (!timingSafeEqual(tokenDigest, this.expectedDigest)) {
      throw new UnauthorizedException('Invalid gitops webhook secret');
    }

    return true;
  }
}

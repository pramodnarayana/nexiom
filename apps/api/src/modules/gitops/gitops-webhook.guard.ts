import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * Guards the POST /internal/gitops/sync endpoint.
 *
 * Validates that the incoming request carries one of:
 *   1. X-Hub-Signature-256 (GitHub) - HMAC SHA256 of raw request body
 *   2. X-Gitlab-Token (GitLab) - exact match to GITOPS_WEBHOOK_SECRET
 *   3. Authorization: Bearer <GITOPS_WEBHOOK_SECRET> (fallback)
 *
 * Uses a constant-time comparison to prevent timing-based secret extraction.
 * Register GITOPS_WEBHOOK_SECRET in GitHub/GitLab as the webhook secret.
 *
 * Returns 401 if:
 *   - None of the above authentication methods are present or valid.
 */
@Injectable()
export class GitopsWebhookGuard implements CanActivate {
  /** Pre-computed SHA-256 digest of the expected secret. Computed once at construction. */
  private readonly expectedDigest: Buffer;
  /** The raw secret for HMAC and exact-match validation. */
  private readonly secret: string;

  constructor(config: ConfigService) {
    const secret = config.getOrThrow<string>('GITOPS_WEBHOOK_SECRET');

    // Validate secret is non-empty and non-whitespace
    const trimmedSecret = secret.trim();
    if (trimmedSecret.length === 0) {
      throw new Error(
        'GITOPS_WEBHOOK_SECRET must be a non-empty, non-whitespace string',
      );
    }

    this.secret = trimmedSecret;
    this.expectedDigest = createHash('sha256').update(trimmedSecret).digest();
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    // Strategy 1: GitHub X-Hub-Signature-256 (HMAC SHA256 of raw body)
    const githubSig = request.headers['x-hub-signature-256'] as
      | string
      | undefined;
    if (githubSig) {
      return this.validateGitHubSignature(request, githubSig);
    }

    // Strategy 2: GitLab X-Gitlab-Token (exact match)
    const gitlabToken = request.headers['x-gitlab-token'] as string | undefined;
    if (gitlabToken) {
      return this.validateGitLabToken(gitlabToken);
    }

    // Strategy 3: Authorization Bearer (fallback)
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return this.validateBearerToken(authHeader);
    }

    throw new UnauthorizedException(
      'Missing or invalid authentication header (expected X-Hub-Signature-256, X-Gitlab-Token, or Authorization: Bearer)',
    );
  }

  private validateGitHubSignature(
    request: Request,
    signature: string,
  ): boolean {
    // Signature format: "sha256=<hex_digest>"
    if (!signature.startsWith('sha256=')) {
      throw new UnauthorizedException('Invalid X-Hub-Signature-256 format');
    }

    const providedDigest = signature.slice(7);

    // Get raw request body (must be available via express.raw() middleware)
    const rawBody = (request as RawBodyRequest<Request>).rawBody;
    if (!rawBody) {
      throw new UnauthorizedException(
        'Raw request body not available for HMAC verification',
      );
    }

    // Compute HMAC SHA256 of raw body
    const expectedHmac = createHmac('sha256', this.secret)
      .update(rawBody)
      .digest('hex');

    // Constant-time comparison
    try {
      const providedBuffer = Buffer.from(providedDigest, 'hex');
      const expectedBuffer = Buffer.from(expectedHmac, 'hex');

      if (providedBuffer.length !== expectedBuffer.length) {
        throw new UnauthorizedException('Invalid GitHub webhook signature');
      }

      if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
        throw new UnauthorizedException('Invalid GitHub webhook signature');
      }

      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException(
        'Invalid GitHub webhook signature format',
      );
    }
  }

  private validateGitLabToken(token: string): boolean {
    // Validate token is non-empty and non-whitespace
    const trimmedToken = token.trim();
    if (trimmedToken.length === 0) {
      throw new UnauthorizedException(
        'X-Gitlab-Token cannot be empty or whitespace',
      );
    }

    // GitLab uses exact match - constant-time comparison
    const tokenDigest = createHash('sha256').update(token).digest();

    if (!timingSafeEqual(tokenDigest, this.expectedDigest)) {
      throw new UnauthorizedException('Invalid GitLab webhook token');
    }

    return true;
  }

  private validateBearerToken(authHeader: string): boolean {
    const token = authHeader.slice(7);

    // Validate token is non-empty and non-whitespace
    const trimmedToken = token.trim();
    if (trimmedToken.length === 0) {
      throw new UnauthorizedException(
        'Bearer token cannot be empty or whitespace',
      );
    }

    const tokenDigest = createHash('sha256').update(token).digest();

    if (!timingSafeEqual(tokenDigest, this.expectedDigest)) {
      throw new UnauthorizedException('Invalid gitops webhook secret');
    }

    return true;
  }
}

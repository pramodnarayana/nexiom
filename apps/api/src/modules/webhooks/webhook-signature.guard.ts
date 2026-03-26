import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DATABASE_CONNECTION, appConnections } from '@nexiom/database';
import type { DrizzleDb } from '@nexiom/database';
import { eq } from 'drizzle-orm';
import { PieceRegistryService } from '@nexiom/engine';
import {
  WEBHOOK_RESOLVED_CONNECTION,
  type WebhookResolvedConnection,
} from '../../guards/tenant-rate-limit.guard.js';

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  constructor(
    @InjectPinoLogger(WebhookSignatureGuard.name)
    private readonly logger: PinoLogger,
    private readonly config: ConfigService,
    private readonly pieceRegistry: PieceRegistryService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<
      Request & {
        rawBody?: Buffer;
        [WEBHOOK_RESOLVED_CONNECTION]?: WebhookResolvedConnection;
      }
    >();
    const connectionId = req.params['connectionId'];

    // Re-use the connection record cached by TenantRateLimitGuard (which always
    // runs first via @UseGuards ordering) to avoid a second DB round-trip.
    const cached = req[WEBHOOK_RESOLVED_CONNECTION];
    const appName = cached
      ? cached.appName
      : await this.resolveAppName(connectionId);

    const piece = this.pieceRegistry.getPiece(appName);
    // Fail closed: a connection referencing an unregistered piece is a
    // configuration error — do not silently pass through.
    if (piece === undefined) {
      throw new NotFoundException(`Piece not registered: "${appName}"`);
    }
    // No webhook config on this piece -- signature check is not required.
    if (!piece.webhook) return true;

    const {
      secretKeyEnv,
      signatureHeader,
      signatureEncoding = 'base64',
    } = piece.webhook;
    const secret = this.config.get<string>(secretKeyEnv);
    if (!secret) {
      this.logger.warn(
        { appName, secretKeyEnv },
        'Webhook secret env var is not set — rejecting',
      );
      throw new ForbiddenException(
        'Webhook signature verification is not configured',
      );
    }

    const receivedSig = req.headers[signatureHeader.toLowerCase()];
    if (!receivedSig || typeof receivedSig !== 'string') {
      throw new ForbiddenException(
        `Missing webhook signature header "${signatureHeader}"`,
      );
    }

    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new ForbiddenException(
        'Empty request body -- signature cannot be verified',
      );
    }

    // Compare raw binary digests (not their encoded string representations) so
    // that casing differences in hex (e.g. "ABCD" vs "abcd") and encoding
    // edge-cases do not cause false-negative rejections.
    const expectedBuf = createHmac('sha256', secret).update(rawBody).digest();

    if (signatureEncoding === 'hex' && receivedSig.length % 2 !== 0) {
      throw new ForbiddenException(
        'Malformed webhook signature (odd-length hex)',
      );
    }

    const receivedBuf = Buffer.from(receivedSig, signatureEncoding);

    if (
      expectedBuf.length !== receivedBuf.length ||
      !timingSafeEqual(expectedBuf, receivedBuf)
    ) {
      this.logger.warn({ connectionId, appName }, 'Webhook signature mismatch');
      throw new ForbiddenException('Invalid webhook signature');
    }

    return true;
  }

  /** Fallback DB lookup when TenantRateLimitGuard has not pre-resolved the connection. */
  private async resolveAppName(connectionId: string): Promise<string> {
    const [conn] = await this.db
      .select({ appName: appConnections.appName })
      .from(appConnections)
      .where(eq(appConnections.id, connectionId))
      .limit(1);

    if (!conn) {
      throw new NotFoundException(`Connection ${connectionId} not found`);
    }
    return conn.appName;
  }
}

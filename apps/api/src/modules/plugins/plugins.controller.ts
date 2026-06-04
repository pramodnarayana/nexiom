import {
  Controller,
  Post,
  Body,
  Headers,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PluginManagerService } from '@soopa/piece-registry';
import * as crypto from 'crypto';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const WebhookPayloadSchema = z
  .object({
    name: z.string().optional(),
    version: z.string().optional(),
    package: z
      .object({
        name: z.string().optional(),
        version: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;
export class WebhookPayloadDto extends createZodDto(WebhookPayloadSchema) {}

@Controller('api/internal/system/plugins')
export class PluginsController {
  private readonly logger = new Logger(PluginsController.name);

  constructor(
    private readonly pluginManager: PluginManagerService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Webhook endpoint triggered by the NPM Registry (e.g., Verdaccio)
   * when a new version of a piece is published.
   */
  @Post('webhook')
  async handleNpmWebhook(
    @Headers('x-npm-signature') signature: string,
    @Body() payloadRaw: WebhookPayloadDto,
  ) {
    const payload = payloadRaw as unknown as WebhookPayload;
    this.logger.log('Received NPM publish webhook event');

    const webhookSecret = this.configService.get<string>('NPM_WEBHOOK_SECRET');

    // Signature validation is mandatory - fail if secret is not configured
    if (!webhookSecret) {
      this.logger.error('NPM_WEBHOOK_SECRET is not configured. Rejecting webhook request.');
      throw new UnauthorizedException('Webhook authentication not configured');
    }

    if (!signature) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    // Validate HMAC signature to ensure request originated from our private registry
    const hmac = crypto.createHmac('sha256', webhookSecret);
    const digest =
      'sha256=' + hmac.update(JSON.stringify(payload)).digest('hex');

    // Use constant-time comparison to prevent timing attacks
    try {
      const signatureBuffer = Buffer.from(signature, 'utf8');
      const digestBuffer = Buffer.from(digest, 'utf8');

      // Fail early if lengths don't match
      if (signatureBuffer.length !== digestBuffer.length) {
        throw new Error('Signature length mismatch');
      }

      if (!crypto.timingSafeEqual(signatureBuffer, digestBuffer)) {
        this.logger.warn(
          'Invalid NPM webhook signature detected. Dropping payload.',
        );
        throw new UnauthorizedException('Invalid webhook signature');
      }
    } catch (error) {
      this.logger.warn(
        'Invalid NPM webhook signature detected. Dropping payload.',
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // Example Verdaccio payload parsing:
    // Extract the package name and version from the webhook payload.
    // Ensure we only process @soopa scopes or allowed packages.
    const packageName = payload?.name || payload?.package?.name;
    const version = payload?.version || payload?.package?.version || 'latest';

    if (!packageName) {
      return { status: 'ignored', reason: 'No package name found in payload' };
    }

    if (!packageName.startsWith('@soopa/')) {
      return {
        status: 'ignored',
        reason: 'Only @soopa packages are hot-loaded',
      };
    }

    this.logger.log(
      `Triggering background install for ${packageName}@${version}...`,
    );

    // Fire-and-forget: acknowledge immediately and process installation asynchronously
    // This prevents webhook timeout issues and allows the registry to receive quick confirmation
    this.pluginManager.installPiece(packageName, version).catch((error: unknown) => {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to install plugin via webhook: ${errorMessage}`,
      );
      // Log for monitoring/alerting - external webhook retries or queue-based retry can be added later
    });

    return {
      status: 'accepted',
      message: `Installation queued for ${packageName}@${version}`,
    };
  }
}

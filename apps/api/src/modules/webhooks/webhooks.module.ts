import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller.js';
import { WebhookSignatureGuard } from './webhook-signature.guard.js';
import { TenantRateLimitGuard } from '../../guards/tenant-rate-limit.guard.js';
import { DbModule } from '../../db/db.module.js';
import { StorageResolverModule, PiecesModule } from '@nexiom/engine';
import { ObservabilityModule } from '../observability/observability.module.js';

// NOTE: TenantRateLimitGuard injects REDIS_CLIENT, which is provided by
// CacheModule. CacheModule must be registered as a global module in AppModule
// for this injection to resolve. If CacheModule is ever made non-global,
// add `CacheModule` to the imports array here.
@Module({
  imports: [DbModule, StorageResolverModule, PiecesModule, ObservabilityModule],
  controllers: [WebhooksController],
  providers: [WebhookSignatureGuard, TenantRateLimitGuard],
})
export class WebhooksModule {}

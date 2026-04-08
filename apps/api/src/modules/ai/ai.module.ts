import { Module } from '@nestjs/common';
import { ObservabilityModule } from '../observability/observability.module.js';
import { AiController } from './_controllers/ai.controller.js';
import { OrchestratorService } from './_services/orchestrator.service.js';
import { AiRateLimitGuard } from './_interceptors/ai-ratelimit.guard.js';
import { AiTelemetryInterceptor } from './_interceptors/ai-telemetry.interceptor.js';
import { ConnectionsModule } from '../connections/connections.module.js';
import { StitchesModule } from '../stitches/stitches.module.js';
import { MetadataModule } from '../metadata/metadata.module.js';

/**
 * AiModule
 *
 * - ObservabilityModule is imported to make @InjectPinoLogger available for
 *   OrchestratorService, AiRateLimitGuard, and AiTelemetryInterceptor.
 * - ConnectionsModule provides TokenManagerService (credential fetching + refresh).
 * - MetadataModule provides MetadataDiscoveryService (cached relation graphs).
 * - PiecesModule is intentionally NOT imported — already registered globally
 *   via AppModule.PiecesModule.forRoot(), so PieceRegistryService is injectable.
 * - CacheModule is likewise global via AppModule.
 */
@Module({
  imports: [
    ObservabilityModule,
    ConnectionsModule,
    StitchesModule,
    MetadataModule,
  ],
  controllers: [AiController],
  providers: [OrchestratorService, AiRateLimitGuard, AiTelemetryInterceptor],
})
export class AiModule {}

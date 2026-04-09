import { Module } from '@nestjs/common';
import { ObservabilityModule } from '../observability/observability.module.js';
import { AiController } from './controllers/ai.controller.js';
import { AiRateLimitGuard } from './interceptors/ai-ratelimit.guard.js';
import { AiTelemetryInterceptor } from './interceptors/ai-telemetry.interceptor.js';
import { AiEngineModule } from '@nexiom/ai-engine';

@Module({
  imports: [ObservabilityModule, AiEngineModule],
  controllers: [AiController],
  providers: [AiRateLimitGuard, AiTelemetryInterceptor],
})
export class AiModule {}

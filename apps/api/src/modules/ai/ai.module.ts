import { Module } from '@nestjs/common';
import { ObservabilityModule } from '../observability/observability.module.js';
import { AiController } from './controllers/ai.controller.js';
import { TransformerSimulationController } from './controllers/transformer-simulation.controller.js';
import { AiRateLimitGuard } from './interceptors/ai-ratelimit.guard.js';
import { AiTelemetryInterceptor } from './interceptors/ai-telemetry.interceptor.js';
import { AiEngineModule } from '@soopa/ai';

import { AiStreamController } from './controllers/ai-stream.controller.js';

@Module({
  imports: [ObservabilityModule, AiEngineModule],
  controllers: [
    AiController,
    TransformerSimulationController,
    AiStreamController,
  ],
  providers: [AiRateLimitGuard, AiTelemetryInterceptor],
})
export class AiModule {}

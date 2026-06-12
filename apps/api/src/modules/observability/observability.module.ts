import { Module, Global } from '@nestjs/common';
import { LoggerModule } from '@soopa/observability';
import { MetricsService } from './metrics.service.js';

@Global()
@Module({
  imports: [LoggerModule.forRoot('app-api') as any],
  providers: [MetricsService],
  exports: [MetricsService], // LoggerModule exported by LoggerModule itself? No, we should export the imported LoggerModule so it's global
})
export class ObservabilityModule {}

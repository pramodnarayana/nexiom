import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { PipelineModule } from "./modules/pipeline/pipeline.module.js";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { PiecesModule } from "@nexiom/piece-registry";
import { QueueModule, createQueueModuleOptions } from "@nexiom/queue";
import { CacheModule } from "@nexiom/cache";
import { ObservabilityModule } from "./modules/observability/observability.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env", "../../.env"],
    }),
    ObservabilityModule,
    PiecesModule.forRoot({ anchorUrl: import.meta.url }),
    ScheduleModule.forRoot(),
    QueueModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: createQueueModuleOptions,
    }),
    CacheModule,
    PipelineModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}

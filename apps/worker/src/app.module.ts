import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { PipelineModule } from "./modules/pipeline/pipeline.module.js";
import { AiWorkerModule } from "./modules/ai/ai.module.js";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { PiecesModule } from "@nexiom/piece-registry";
import { QueueModule, createQueueModuleOptions } from "@nexiom/queue";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    PiecesModule.forRoot({ anchorUrl: import.meta.url }),
    ScheduleModule.forRoot(),
    QueueModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: createQueueModuleOptions,
    }),
    PipelineModule,
    AiWorkerModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}

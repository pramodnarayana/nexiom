import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { PipelineModule } from "./modules/pipeline/pipeline.module.js";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { PiecesModule } from "@nexiom/engine";
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
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}

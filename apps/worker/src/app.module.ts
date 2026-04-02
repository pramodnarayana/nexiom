import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { PipelineModule } from "./modules/pipeline/pipeline.module.js";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { PiecesModule } from "@nexiom/engine";
import { QueueModule } from "@nexiom/queue";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: "../../.env" }),
    PiecesModule.forRoot({ anchorUrl: import.meta.url }),
    ScheduleModule.forRoot(),
    QueueModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        infraMode: cfg.get<string>("INFRA_MODE", "local") as
          | "local"
          | "production",
        endpoint: cfg.get<string>("SQS_ENDPOINT"),
        region: cfg.get<string>("AWS_REGION", "us-east-1"),
        accountId: cfg.get<string>("AWS_ACCOUNT_ID"),
      }),
    }),
    PipelineModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { PipelineCoreModule } from "@soopa/pipeline";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { PiecesModule } from "@soopa/piece-registry";
import { QueueModule, createQueueModuleOptions } from "@soopa/queue";
import { CacheModule } from "@soopa/cache";
import { ObservabilityModule } from "./bootstrap/observability/observability.module.js";
import { DatabaseModule } from "@soopa/database";
import { DbManagerModule } from "./bootstrap/dbmanager/dbmanager.module.js";
import { EventEmitterModule } from "@nestjs/event-emitter";

// Consumers
import { CopilotWorker } from "./consumers/copilot.worker.js";
import { ActiveFetchWorker } from "./consumers/active-fetch.worker.js";
import { GitopsSyncWorker } from "./consumers/gitops-sync.worker.js";
import { AppInstallerProcessor } from "./consumers/app-installer.processor.js";

// Pollers
import { InboundOutboxPoller } from "./pollers/inbound-outbox.poller.js";
import { ReplicaOutboxPoller } from "./pollers/replica-outbox.poller.js";
import { NormalizedOutboxPoller } from "./pollers/normalized-outbox.poller.js";
import { RegistryOutboxPoller } from "./pollers/registry-outbox.poller.js";

// Cron
import { AppUpdaterCron } from "./cron/app-updater.cron.js";

@Module({
  imports: [
    EventEmitterModule.forRoot({ global: true }),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env", "../../.env"],
    }),
    DatabaseModule,
    DbManagerModule,
    ObservabilityModule,
    PiecesModule.forRoot(),
    ...(process.env.ENABLE_PLUGIN_MIGRATIONS === "true"
      ? [PiecesModule.withMigrations()]
      : []),
    ScheduleModule.forRoot(),
    QueueModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: createQueueModuleOptions,
    }),
    CacheModule,
    PipelineCoreModule,
  ],
  controllers: [],
  providers: [
    CopilotWorker,
    ActiveFetchWorker,
    GitopsSyncWorker,
    AppInstallerProcessor,
    InboundOutboxPoller,
    ReplicaOutboxPoller,
    NormalizedOutboxPoller,
    RegistryOutboxPoller,
    AppUpdaterCron,
  ],
})
export class AppModule {}

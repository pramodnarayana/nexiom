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

// Adapters
import { NestQueuePublisherAdapter } from "./adapters/outbound/nest-queue.publisher.js";
import { DrizzleDataSourceRepositoryAdapter } from "./adapters/outbound/drizzle-data-source.repository.js";
import { NestPipelineHookBrokerAdapter } from "./adapters/outbound/nest-pipeline-hook-broker.adapter.js";
import { NestChatStreamOrchestratorAdapter } from "./adapters/outbound/nest-chat-stream-orchestrator.adapter.js";
import { RedisRealtimeEventPubSubAdapter } from "./adapters/outbound/redis-realtime-event-pubsub.adapter.js";
import { NestChatPersistenceAdapter } from "./adapters/outbound/nest-chat-persistence.adapter.js";
import { AiSdkTitleGeneratorAdapter } from "./adapters/outbound/ai-sdk-title-generator.adapter.js";
import { DrizzleWorkspacePiecesRepositoryAdapter } from "./adapters/outbound/drizzle-workspace-pieces.repository.js";
import { NestPieceRegistryAdapter } from "./adapters/outbound/nest-piece-registry.adapter.js";
import { NodeFsGitRepositoryAdapter } from "./adapters/outbound/node-fs-git-repository.adapter.js";
import { NestCacheInvalidatorAdapter } from "./adapters/outbound/nest-cache-invalidator.adapter.js";

// Ai Module

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
    // Adapters
    NestQueuePublisherAdapter,
    DrizzleDataSourceRepositoryAdapter,
    NestPipelineHookBrokerAdapter,
    NestChatStreamOrchestratorAdapter,
    RedisRealtimeEventPubSubAdapter,
    NestChatPersistenceAdapter,
    AiSdkTitleGeneratorAdapter,
    DrizzleWorkspacePiecesRepositoryAdapter,
    NestPieceRegistryAdapter,
    NodeFsGitRepositoryAdapter,
    NestCacheInvalidatorAdapter,

    // Consumers
    CopilotWorker,
    ActiveFetchWorker,
    GitopsSyncWorker,
    AppInstallerProcessor,

    // Pollers
    InboundOutboxPoller,
    ReplicaOutboxPoller,
    NormalizedOutboxPoller,
    RegistryOutboxPoller,

    // Cron
    AppUpdaterCron,
  ],
})
export class AppModule {}

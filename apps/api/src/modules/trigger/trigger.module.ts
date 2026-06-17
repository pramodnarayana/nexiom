import { Module } from '@nestjs/common';
import { DatabaseModule, DATABASE_CONNECTION } from '@soopa/database';
import { REDIS_CLIENT } from '@soopa/cache';
import type { Redis } from '@soopa/cache';

import { PieceRegistryService } from '@soopa/piece-registry';
import { PollerService } from './poller.service.js';
import { DlqProcessorService } from './dlq-processor.service.js';
import { TriggerPayloadTransformer } from './trigger-payload-transformer.js';
import { TriggerRetryPolicyService } from './trigger-retry-policy.service.js';
import type { DrizzleDb } from '@soopa/database';
import { StorageResolverModule } from '@soopa/pipeline';
import { IDistributedLockService } from './interfaces/distributed-lock.interface.js';
import { ITriggerDlqService } from './interfaces/trigger-dlq.interface.js';
import { RedisDistributedLockService } from './infrastructure/redis-distributed-lock.service.js';
import { RedisTriggerDlqService } from './infrastructure/redis-trigger-dlq.service.js';

// --- Adapters ---
import { DrizzleTriggerGatewayRepositoryAdapter } from './adapters/outbound/drizzle-trigger-gateway.adapter.js';
import { DrizzleTriggerAppConnectionAdapter } from './adapters/outbound/drizzle-trigger-app-connection.adapter.js';
import { PipelineDatabaseProvisionerAdapter } from './adapters/outbound/pipeline-database-provisioner.adapter.js';
import { PipelineTriggerStorageResolverAdapter } from './adapters/outbound/pipeline-trigger-storage-resolver.adapter.js';

// --- Use Cases ---
import { RunWebhookUseCase } from './core/use-cases/run-webhook.use-case.js';
import { RunPollUseCase } from './core/use-cases/run-poll.use-case.js';
import { EnableTriggerUseCase } from './core/use-cases/enable-trigger.use-case.js';
import { DisableTriggerUseCase } from './core/use-cases/disable-trigger.use-case.js';

@Module({
  imports: [DatabaseModule, StorageResolverModule],
  providers: [
    {
      provide: IDistributedLockService,
      useClass: RedisDistributedLockService,
    },
    {
      provide: ITriggerDlqService,
      useClass: RedisTriggerDlqService,
    },
    {
      provide: 'KEY_VALUE_STORE',
      useFactory: (redis: Redis) => redis,
      inject: [REDIS_CLIENT],
    },
    TriggerPayloadTransformer,
    TriggerRetryPolicyService,

    // Adapters
    {
      provide: 'TRIGGER_GATEWAY_REPOSITORY_PORT',
      useClass: DrizzleTriggerGatewayRepositoryAdapter,
    },
    {
      provide: 'TRIGGER_APP_CONNECTION_REPOSITORY_PORT',
      useClass: DrizzleTriggerAppConnectionAdapter,
    },
    {
      provide: 'DATABASE_PROVISIONER_PORT',
      useClass: PipelineDatabaseProvisionerAdapter,
    },
    {
      provide: 'TRIGGER_STORAGE_RESOLVER_PORT',
      useClass: PipelineTriggerStorageResolverAdapter,
    },

    // Use Cases
    RunWebhookUseCase,
    RunPollUseCase,
    EnableTriggerUseCase,
    DisableTriggerUseCase,

    {
      provide: PollerService,
      useFactory: (
        db: DrizzleDb,
        runPollUseCase: RunPollUseCase,
        registry: PieceRegistryService,
      ) => new PollerService(db, runPollUseCase, registry),
      inject: [DATABASE_CONNECTION, RunPollUseCase, PieceRegistryService],
    },
    {
      provide: DlqProcessorService,
      useFactory: (
        dlqService: ITriggerDlqService,
        runPollUseCase: RunPollUseCase,
        registry: PieceRegistryService,
      ) => new DlqProcessorService(dlqService, runPollUseCase, registry),
      inject: [ITriggerDlqService, RunPollUseCase, PieceRegistryService],
    },
  ],
  exports: [
    RunWebhookUseCase,
    RunPollUseCase,
    EnableTriggerUseCase,
    DisableTriggerUseCase,
  ],
})
export class TriggerModule {}

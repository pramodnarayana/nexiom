import { Module } from "@nestjs/common";
import { QueueModule } from "@soopa/queue";
import { StorageResolverModule } from "./storage-resolver/storage-resolver.module.js";
import { ApplicationLoaderModule } from "./sharding/application-loader.module.js";
import { PiecesModule } from "@soopa/piece-registry";
import {
  TokenManagerService,
  AesEncryptionService,
  EncryptionService,
  OAuthRefreshClient,
  RedisDistributedLock,
} from "@soopa/credentials";
import { RegistryOAuthRefreshClient } from "./replication/registry-token-refresh.service.js";
import { DATABASE_CONNECTION } from "@soopa/database";
import type { DrizzleDb } from "@soopa/database";
import type { Redis } from "ioredis";

import { ReplicaService } from "./replication/replica.service.js";
import { NormalizationService } from "./normalization/normalization.service.js";
import { TargetBuilderService } from "./fanout/target-builder.service.js";
import { FanoutRouterService } from "./fanout/fanout-router.service.js";
import { FanoutBatchProcessor } from "./fanout/fanout-batch-processor.js";
import { RoutingDecisionEngine } from "./fanout/routing-decision.engine.js";
import { ROUTING_REPOSITORY_PORT } from "./shared/ports/routing.repository.port.js";
import { DrizzleRoutingRepositoryAdapter } from "./shared/adapters/drizzle-routing.repository.js";
import { CONNECTION_REPOSITORY_PORT } from "./shared/ports/connection.repository.port.js";
import { DrizzleConnectionRepositoryAdapter } from "./shared/adapters/drizzle-connection.repository.js";
import { STITCH_REPOSITORY_PORT } from "./shared/ports/stitch.repository.port.js";
import { DrizzleSharedStitchRepositoryAdapter } from "./shared/adapters/drizzle-stitch.repository.js";
import { PIPELINE_STATE_REPOSITORY_PORT } from "./shared/ports/pipeline-state.repository.port.js";
import { DrizzlePipelineStateRepositoryAdapter } from "./shared/adapters/drizzle-pipeline-state.repository.js";
import { GLOBAL_ENTITY_MAP_REPOSITORY_PORT } from "./shared/ports/global-entity-map.repository.port.js";
import { DrizzleGlobalEntityMapRepositoryAdapter } from "./shared/adapters/drizzle-global-entity-map.repository.js";
import { FIELD_MAPPING_REPOSITORY_PORT } from "./shared/ports/field-mapping.repository.port.js";
import { DrizzleFieldMappingRepositoryAdapter } from "./shared/adapters/drizzle-field-mapping.repository.js";
import { SYNC_LOG_REPOSITORY_PORT } from "./shared/ports/sync-log.repository.port.js";
import { DrizzleSyncLogRepositoryAdapter } from "./shared/adapters/drizzle-sync-log.repository.js";
import { OUTBOUND_GATEWAY_REPOSITORY_PORT } from "./shared/ports/outbound-gateway.repository.port.js";
import { DrizzleOutboundGatewayRepositoryAdapter } from "./shared/adapters/drizzle-outbound-gateway.repository.js";
import { NORMALIZATION_REPOSITORY_PORT } from "./shared/ports/normalization.repository.port.js";
import { DrizzleNormalizationRepositoryAdapter } from "./shared/adapters/drizzle-normalization.repository.js";
import { TRANSACTION_MANAGER_PORT } from "./shared/ports/transaction-manager.port.js";
import { DrizzleTransactionManagerAdapter } from "./shared/adapters/drizzle-transaction-manager.adapter.js";
import { DeliveryService } from "./delivery/delivery.service.js";
import { PieceOutboundDispatcher } from "./delivery/piece-outbound.dispatcher.js";
import { DeliveryRetryService } from "./delivery/delivery-retry.service.js";
import { GemHydrationService } from "./delivery/gem-hydration.service.js";
import { RegistryReplicationService } from "./replication/registry-replication.service.js";
import { DependencySweeperService } from "./normalization/dependency-sweeper.service.js";

import { OutboundGatewayAdapter } from "./shared/adapters/outbound-gateway.adapter.js";
import { RegistryReplicationAdapter } from "./shared/adapters/registry-replication.adapter.js";
import { ReplicaStateAdapter } from "./shared/adapters/replica-state.adapter.js";

import { ClaimDeliveryUseCase } from "./delivery/use-cases/claim-delivery.use-case.js";

@Module({
  imports: [
    QueueModule,
    StorageResolverModule,
    ApplicationLoaderModule,
    PiecesModule,
  ],
  providers: [
    ReplicaService,
    NormalizationService,
    TargetBuilderService,
    FanoutRouterService,
    FanoutBatchProcessor,
    RoutingDecisionEngine,
    {
      provide: ROUTING_REPOSITORY_PORT,
      useClass: DrizzleRoutingRepositoryAdapter,
    },
    {
      provide: CONNECTION_REPOSITORY_PORT,
      useClass: DrizzleConnectionRepositoryAdapter,
    },
    {
      provide: STITCH_REPOSITORY_PORT,
      useClass: DrizzleSharedStitchRepositoryAdapter,
    },
    {
      provide: PIPELINE_STATE_REPOSITORY_PORT,
      useClass: DrizzlePipelineStateRepositoryAdapter,
    },
    {
      provide: GLOBAL_ENTITY_MAP_REPOSITORY_PORT,
      useClass: DrizzleGlobalEntityMapRepositoryAdapter,
    },
    {
      provide: FIELD_MAPPING_REPOSITORY_PORT,
      useClass: DrizzleFieldMappingRepositoryAdapter,
    },
    {
      provide: SYNC_LOG_REPOSITORY_PORT,
      useClass: DrizzleSyncLogRepositoryAdapter,
    },
    {
      provide: OUTBOUND_GATEWAY_REPOSITORY_PORT,
      useClass: DrizzleOutboundGatewayRepositoryAdapter,
    },
    {
      provide: NORMALIZATION_REPOSITORY_PORT,
      useClass: DrizzleNormalizationRepositoryAdapter,
    },
    {
      provide: TRANSACTION_MANAGER_PORT,
      useClass: DrizzleTransactionManagerAdapter,
    },
    {
      provide: "IOutboundDispatcher",
      useClass: PieceOutboundDispatcher,
    },
    {
      provide: "IOutboundGatewayPort",
      useClass: OutboundGatewayAdapter,
    },
    {
      provide: "IRegistryReplicationPort",
      useClass: RegistryReplicationAdapter,
    },
    {
      provide: "IReplicaStatePort",
      useClass: ReplicaStateAdapter,
    },
    ClaimDeliveryUseCase,
    DeliveryService,
    DeliveryRetryService,
    GemHydrationService,
    DependencySweeperService,
    RegistryReplicationService,
    {
      provide: EncryptionService,
      useClass: AesEncryptionService,
    },
    {
      provide: OAuthRefreshClient,
      useClass: RegistryOAuthRefreshClient,
    },
    {
      provide: TokenManagerService,
      useFactory: (
        db: DrizzleDb,
        redis: Redis,
        crypto: EncryptionService,
        refreshClient: OAuthRefreshClient,
      ) => {
        return new TokenManagerService(
          db,
          new RedisDistributedLock(redis),
          crypto,
          refreshClient,
        );
      },
      inject: [
        DATABASE_CONNECTION,
        "REDIS_CLIENT",
        EncryptionService,
        OAuthRefreshClient,
      ],
    },
  ],
  exports: [
    ReplicaService,
    NormalizationService,
    TargetBuilderService,
    FanoutRouterService,
    FanoutBatchProcessor,
    DeliveryService,
    DependencySweeperService,
    RegistryReplicationService,
    GemHydrationService
  ],
})
export class PipelineCoreModule {
  constructor(
    private readonly deliveryService: DeliveryService,
    private readonly registryReplicationService: RegistryReplicationService,
  ) {}
}

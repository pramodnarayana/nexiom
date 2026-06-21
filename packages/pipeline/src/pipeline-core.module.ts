import { Module } from "@nestjs/common";
import { QueueModule } from "@soopa/queue";
import { StorageResolverModule } from "./storage-resolver/storage-resolver.module.js";
import { PipelineHookBrokerService } from "./plugin-hooks/pipeline-hook-broker.service.js";
import { PiecesModule } from "@soopa/piece-registry";
import {
  TokenManagerService,
  OAuthRefreshClient,
  RedisDistributedLock,
} from "@soopa/credentials";
import { IEncryptionService, ENCRYPTION_SERVICE } from "@soopa/security";

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
import { DrizzleRoutingRepositoryAdapter } from "./shared/adapters/outbound/drizzle-routing.adapter.js";
import { CONNECTION_REPOSITORY_PORT } from "./shared/ports/connection.repository.port.js";
import { DrizzleConnectionRepositoryAdapter } from "./shared/adapters/outbound/drizzle-connection.adapter.js";
import { STITCH_REPOSITORY_PORT } from "./shared/ports/stitch.repository.port.js";
import { DrizzleSharedStitchRepositoryAdapter } from "./shared/adapters/outbound/drizzle-stitch.adapter.js";
import { PIPELINE_STATE_REPOSITORY_PORT } from "./shared/ports/pipeline-state.repository.port.js";
import { DrizzlePipelineStateRepositoryAdapter } from "./shared/adapters/outbound/drizzle-pipeline-state.adapter.js";
import { GLOBAL_ENTITY_MAP_REPOSITORY_PORT } from "./shared/ports/global-entity-map.repository.port.js";
import { DrizzleGlobalEntityMapRepositoryAdapter } from "./shared/adapters/outbound/drizzle-global-entity-map.adapter.js";
import { FIELD_MAPPING_REPOSITORY_PORT } from "./shared/ports/field-mapping.repository.port.js";
import { DrizzleFieldMappingRepositoryAdapter } from "./shared/adapters/outbound/drizzle-field-mapping.adapter.js";
import { SYNC_LOG_REPOSITORY_PORT } from "./shared/ports/sync-log.repository.port.js";
import { DrizzleSyncLogRepositoryAdapter } from "./shared/adapters/outbound/drizzle-sync-log.adapter.js";
import { OUTBOUND_GATEWAY_REPOSITORY_PORT } from "./shared/ports/outbound-gateway.repository.port.js";
import { DrizzleOutboundGatewayRepositoryAdapter } from "./shared/adapters/outbound/drizzle-outbound-gateway.adapter.js";
import { NORMALIZATION_REPOSITORY_PORT } from "./shared/ports/normalization.repository.port.js";
import { DrizzleNormalizationRepositoryAdapter } from "./shared/adapters/outbound/drizzle-normalization.adapter.js";
import { TRANSACTION_MANAGER_PORT } from "./shared/ports/transaction-manager.port.js";
import { DrizzleTransactionManagerAdapter } from "./shared/adapters/outbound/drizzle-transaction-manager.adapter.js";
import { DEPENDENCY_SWEEPER_REPOSITORY_PORT } from "./shared/ports/dependency-sweeper.repository.port.js";
import { DrizzleDependencySweeperRepositoryAdapter } from "./shared/adapters/outbound/drizzle-dependency-sweeper.adapter.js";
import { DeliveryService } from "./delivery/delivery.service.js";
import { PieceOutboundDispatcher } from "./delivery/piece-outbound.dispatcher.js";
import { DeliveryRetryService } from "./delivery/delivery-retry.service.js";
import { GemHydrationService } from "./delivery/gem-hydration.service.js";
import { DependencySweeperService } from "./normalization/dependency-sweeper.service.js";


import { OutboundGatewayAdapter } from "./shared/adapters/outbound/outbound-gateway.adapter.js";

import { ReplicaStateAdapter } from "./shared/adapters/outbound/replica-state.adapter.js";

import { ClaimDeliveryUseCase } from "./delivery/use-cases/claim-delivery.use-case.js";

@Module({
  imports: [
    QueueModule,
    StorageResolverModule,
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
      provide: DEPENDENCY_SWEEPER_REPOSITORY_PORT,
      useClass: DrizzleDependencySweeperRepositoryAdapter,
    },
    {
      provide: "IOutboundDispatcher",
      useClass: PieceOutboundDispatcher,
    },
    {
      provide: "OutboundGatewayPort",
      useClass: OutboundGatewayAdapter,
    },

    {
      provide: "ReplicaStatePort",
      useClass: ReplicaStateAdapter,
    },
    ClaimDeliveryUseCase,
    DeliveryService,
    DeliveryRetryService,
    GemHydrationService,
    DependencySweeperService,
    
    PipelineHookBrokerService,
  ],
  exports: [
    ReplicaService,
    NormalizationService,
    TargetBuilderService,
    FanoutRouterService,
    FanoutBatchProcessor,
    DeliveryService,
    DependencySweeperService,
    GemHydrationService,
    PipelineHookBrokerService
  ],
})
export class PipelineCoreModule {
  constructor(
    private readonly deliveryService: DeliveryService,
  ) {}
}

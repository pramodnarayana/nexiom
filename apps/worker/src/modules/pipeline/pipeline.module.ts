import { Module } from "@nestjs/common";
import { QueueModule } from "@soopa/queue";
import { DbModule } from "../../db/db.module.js";
import { DbManagerModule } from "../dbmanager/dbmanager.module.js";
import { StorageResolverModule, ApplicationLoaderModule } from "@soopa/engine";
import {
  TokenManagerService,
  AesEncryptionService,
  EncryptionService,
  OAuthRefreshClient,
  RedisDistributedLock,
} from "@soopa/credentials";
import { RegistryOAuthRefreshClient } from "./registry-token-refresh.service.js";
import { DATABASE_CONNECTION } from "@soopa/database";
import type { DrizzleDb } from "@soopa/database";
import { PiecesModule } from "@soopa/piece-registry";
import type { Redis } from "ioredis";

import { ReplicaService } from "./replica.service.js";
import { NormalizationService } from "./normalization.service.js";
import { TargetBuilderService } from "./target-builder.service.js";
import { FanoutRouterService } from "./fanout-router.service.js";
import { FanoutBatchProcessor } from "./fanout-batch-processor.js";
import { RoutingDecisionEngine } from "./routing-decision.engine.js";
import { DeliveryService } from "./delivery.service.js";
import { PieceOutboundDispatcher } from "./piece-outbound.dispatcher.js";
import { DeliveryRetryService } from "./delivery-retry.service.js";
import { GemHydrationService } from "./gem-hydration.service.js";
import { GitopsSyncWorker } from "./gitops-sync.worker.js";
import { RegistryReplicationService } from "./registry-replication.service.js";

import { ActiveFetchWorker } from "./active-fetch.worker.js";
import { DependencySweeperService } from "./dependency-sweeper.service.js";

// Outbox Pollers
import { InboundOutboxPoller } from "./inbound-outbox.poller.js";
import { ReplicaOutboxPoller } from "./replica-outbox.poller.js";
import { NormalizedOutboxPoller } from "./normalized-outbox.poller.js";
import { RegistryOutboxPoller } from "./registry-outbox.poller.js";

@Module({
  imports: [
    QueueModule,
    DbModule,
    DbManagerModule,
    StorageResolverModule,
    ApplicationLoaderModule,
    PiecesModule,
  ],

  providers: [
    ReplicaService,
    NormalizationService, // Extended with app canonical write hook (step 3.5)
    TargetBuilderService, // SQL JOIN enrichment for target payload assembly
    FanoutRouterService,
    FanoutBatchProcessor,
    RoutingDecisionEngine,
    {
      provide: "IOutboundDispatcher",
      useClass: PieceOutboundDispatcher,
    },
    DeliveryService,
    DeliveryRetryService,
    GemHydrationService,
    GitopsSyncWorker,
    ActiveFetchWorker,
    DependencySweeperService,
    RegistryReplicationService,

    // Outbox Pollers
    InboundOutboxPoller,
    ReplicaOutboxPoller,
    NormalizedOutboxPoller,
    RegistryOutboxPoller,

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
  ],
})
export class PipelineModule {
  // Intentionally injected to force eager instantiation
  constructor(
    private readonly deliveryService: DeliveryService,
    private readonly registryReplicationService: RegistryReplicationService,
  ) {}
}

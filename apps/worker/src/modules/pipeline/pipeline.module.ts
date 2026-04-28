import { Module } from "@nestjs/common";
import { QueueModule } from "@nexiom/queue";
import { DbModule } from "../../db/db.module.js";
import { StorageResolverModule } from "@nexiom/engine";
import {
  TokenManagerService,
  AesEncryptionService,
  EncryptionService,
  OAuthRefreshClient,
} from "@nexiom/credentials";
import { RegistryOAuthRefreshClient } from "./registry-token-refresh.service.js";
import { DATABASE_CONNECTION } from "@nexiom/database";
import type { DrizzleDb } from "@nexiom/database";
import { PiecesModule } from "@nexiom/piece-registry";
import type { Redis } from "ioredis";

import { ReplicaService } from "./replica.service.js";
import { NormalizationService } from "./normalization.service.js";
import { TargetBuilderService } from "./target-builder.service.js";
import { FanOutService } from "./fanout.service.js";
import { DeliveryService } from "./delivery.service.js";
import { NormalizedOutboxWorker } from "./normalized-outbox.worker.js";
import { DeliveryOutboxWorker } from "./delivery-outbox.worker.js";
import { GitopsSyncWorker } from "./gitops-sync.worker.js";

@Module({
  imports: [QueueModule, DbModule, StorageResolverModule, PiecesModule],
  providers: [
    ReplicaService,
    NormalizationService, // Extended with app canonical write hook (step 3.5)
    TargetBuilderService, // SQL JOIN enrichment for target payload assembly
    FanOutService,
    DeliveryService,
    NormalizedOutboxWorker,
    DeliveryOutboxWorker,
    GitopsSyncWorker,
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
        return new TokenManagerService(db, redis, crypto, refreshClient);
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
    FanOutService,
    DeliveryService,
  ],
})
export class PipelineModule {
  constructor(private readonly deliveryService: DeliveryService) {}
}

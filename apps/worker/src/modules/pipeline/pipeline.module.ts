import { Module } from "@nestjs/common";
import { QueueModule } from "@nexiom/queue";
import { DbModule } from "../../db/db.module.js";
import { StorageResolverModule } from "@nexiom/engine";
import { PiecesModule } from "@nexiom/piece-registry";

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
  ],
  exports: [
    ReplicaService,
    NormalizationService,
    TargetBuilderService,
    FanOutService,
    DeliveryService,
  ],
})
export class PipelineModule {}

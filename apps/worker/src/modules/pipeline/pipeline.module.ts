import { Module } from "@nestjs/common";
import { QueueModule } from "@nexiom/queue";
import { DbModule } from "../../db/db.module.js";
import { StorageResolverModule, PiecesModule } from "@nexiom/engine";

import { ReplicaService } from "./replica.service.js";
import { NormalizationService } from "./normalization.service.js";
import { FanOutService } from "./fanout.service.js";
import { DeliveryService } from "./delivery.service.js";

@Module({
  imports: [
    QueueModule,
    DbModule,
    StorageResolverModule,
    PiecesModule.forRoot({ anchorUrl: import.meta.url }),
  ],
  providers: [
    ReplicaService,
    NormalizationService,
    FanOutService,
    DeliveryService,
  ],
  exports: [
    ReplicaService,
    NormalizationService,
    FanOutService,
    DeliveryService,
  ],
})
export class PipelineModule {}

import { Module } from "@nestjs/common";
import { QueueModule } from "@soopa/queue";


import { SchemaProvisionWorker } from "./provisioning/schema-provision.worker.js";
import { RegistryReplicationService } from "./registry/registry-replication.service.js";
import { RegistryOAuthRefreshClient } from "./registry/registry-token-refresh.service.js";
import { RegistryReplicationAdapter } from "./shared/adapters/outbound/registry-replication.adapter.js";

@Module({
  imports: [
    QueueModule,
  ],
  providers: [
    {
      provide: "RegistryReplicationPort",
      useClass: RegistryReplicationAdapter,
    },
    SchemaProvisionWorker,
    RegistryReplicationService,
    RegistryOAuthRefreshClient,
  ],
  exports: [
    SchemaProvisionWorker,
    RegistryReplicationService,
    RegistryOAuthRefreshClient,
  ],
})
export class ProvisionModule {}

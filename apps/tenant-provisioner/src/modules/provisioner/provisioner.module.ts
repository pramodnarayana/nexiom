import { Module } from "@nestjs/common";
import { QueueModule } from "@soopa/queue";
import { TenantProvisionWorker } from "./tenant-provision.worker.js";

@Module({
  imports: [QueueModule],
  providers: [TenantProvisionWorker],
})
export class ProvisionerModule {}

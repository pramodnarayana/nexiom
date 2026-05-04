import { Module } from "@nestjs/common";
import { QueueModule } from "@nexiom/queue";
import { TenantProvisionWorker } from "./tenant-provision.worker.js";

@Module({
  imports: [QueueModule],
  providers: [TenantProvisionWorker],
})
export class ProvisionerModule {}

import { Module } from "@nestjs/common";
import { QueueModule } from "@soopa/queue";
import { MigratorModule } from "@soopa/migrator";
import { TenantProvisionWorker } from "./tenant-provision.worker.js";

@Module({
  imports: [QueueModule, MigratorModule],
  providers: [TenantProvisionWorker],
})
export class ProvisionerModule {}

import { Module, Global } from "@nestjs/common";
import { DOMAIN_PROVISIONER } from "@soopa/provision";
import { DomainProvisionerAdapter } from "./domain-provisioner.adapter.js";
import { DbManagerModule } from "../dbmanager/dbmanager.module.js";
import { DatabaseModule } from "@soopa/database";
import { MigratorModule } from "@soopa/migrator";

@Global()
@Module({
  imports: [DbManagerModule, DatabaseModule, MigratorModule],
  providers: [
    {
      provide: DOMAIN_PROVISIONER,
      useClass: DomainProvisionerAdapter,
    },
  ],
  exports: [DOMAIN_PROVISIONER],
})
export class DomainProvisionerModule {}

import { Module } from '@nestjs/common';
import { PgConnectionPool } from '../infrastructure/pg-connection.pool.js';
import { MigrationRunnerService } from '../infrastructure/migration-runner.service.js';
import { SystemSeederService } from '../services/system-seeder.service.js';
import { SyncSeedingService } from '../services/sync-seeding.service.js';
import { DbSeedCommand } from './commands/db-seed.command.js';
import { DbResetCommand } from './commands/db-reset.command.js';
import { DbFreshCommand } from './commands/db-fresh.command.js';
import { DbMigrateCommand } from './commands/db-migrate.command.js';
import { DbProvisionCommand } from './commands/db-provision.command.js';
import { DbDebugCommand } from './commands/db-debug.command.js';
import { EnvironmentGuardService } from '../services/environment-guard.service.js';
import { DatabaseResetService } from '../services/database-reset.service.js';
import { RbacInspectorService } from '../services/rbac-inspector.service.js';
import { TenantSchemaService } from '../services/tenant-schema.service.js';
import { DevSandboxProvisionerService } from '../services/dev-sandbox-provisioner.service.js';
import { ConnectionSchemaProvisionerService } from '../services/connection-schema-provisioner.service.js';

@Module({
  providers: [
    PgConnectionPool,
    EnvironmentGuardService,
    MigrationRunnerService,
    SystemSeederService,
    SyncSeedingService,
    DatabaseResetService,
    RbacInspectorService,
    TenantSchemaService,
    DevSandboxProvisionerService,
    ConnectionSchemaProvisionerService,
    DbSeedCommand,
    DbResetCommand,
    DbFreshCommand,
    DbMigrateCommand,
    DbProvisionCommand,
    DbDebugCommand,
  ],
})
export class DatabaseCliModule {}

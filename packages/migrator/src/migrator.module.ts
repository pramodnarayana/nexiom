import { Module } from '@nestjs/common';
import { MIGRATION_RUNNER } from './ports/migration-runner.port.js';
import { DrizzleCustomMigrationRunnerAdapter } from './adapters/drizzle-custom-migration-runner.adapter.js';

@Module({
  providers: [
    {
      provide: MIGRATION_RUNNER,
      useClass: DrizzleCustomMigrationRunnerAdapter,
    },
  ],
  exports: [MIGRATION_RUNNER],
})
export class MigratorModule {}

import { Module } from '@nestjs/common';
import { MIGRATION_RUNNER } from './ports/migration-runner.port.js';
import { DrizzleMigrationRunnerAdapter } from './adapters/drizzle-migration-runner.adapter.js';

@Module({
  providers: [
    {
      provide: MIGRATION_RUNNER,
      useClass: DrizzleMigrationRunnerAdapter,
    },
  ],
  exports: [MIGRATION_RUNNER],
})
export class MigratorModule {}

import { Command, CommandRunner } from 'nest-commander';
import { MigrationRunnerService } from '../../infrastructure/migration-runner.service.js';

@Command({
  name: 'db:migrate',
  description: 'Runs drizzle migrations for base schemas',
})
export class DbMigrateCommand extends CommandRunner {
  constructor(private readonly migrationRunner: MigrationRunnerService) {
    super();
  }

  async run(): Promise<void> {
    try {
      await this.migrationRunner.migrateAllSchemas();
    } catch (err) {
      console.error('Failed to migrate database:', err);
      process.exit(1);
    }
  }
}

import { Command, CommandRunner } from 'nest-commander';
import { DatabaseResetService } from '../../services/database-reset.service.js';

@Command({
  name: 'db:fresh',
  description: 'Drops all data, runs migrations, and seeds the database',
})
export class DbFreshCommand extends CommandRunner {
  constructor(private readonly resetService: DatabaseResetService) {
    super();
  }

  async run(): Promise<void> {
    try {
      await this.resetService.fresh();
    } catch (err) {
      console.error('Failed to fresh install database:', err);
      process.exit(1);
    }
  }
}

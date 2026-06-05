import { Command, CommandRunner } from 'nest-commander';
import { DatabaseResetService } from '../../services/database-reset.service.js';

@Command({
  name: 'db:reset',
  description: 'Truncates all data and seeds the database',
})
export class DbResetCommand extends CommandRunner {
  constructor(private readonly resetService: DatabaseResetService) {
    super();
  }

  async run(): Promise<void> {
    try {
      await this.resetService.reset();
    } catch (err) {
      console.error('Failed to reset database:', err);
      throw err;
    }
  }
}

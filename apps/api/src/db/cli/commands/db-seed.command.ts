import { Command, CommandRunner } from 'nest-commander';
import { SystemSeederService } from '../../services/system-seeder.service.js';
import { SyncSeedingService } from '../../services/sync-seeding.service.js';
import { ABAC_PERMISSIONS } from '../../data/seed-abac.js';
import { LOCAL_SEED_MAPPINGS } from '../../data/seed-mappings.js';

@Command({
  name: 'db:seed',
  description: 'Seeds the database with system defaults',
})
export class DbSeedCommand extends CommandRunner {
  constructor(
    private readonly seederService: SystemSeederService,
    private readonly syncSeederService: SyncSeedingService,
  ) {
    super();
  }

  async run(): Promise<void> {
    try {
      await this.seederService.seed();
      await this.seederService.seedAbac(ABAC_PERMISSIONS);
      await this.syncSeederService.seedMappings(LOCAL_SEED_MAPPINGS);
      console.log('Database seed completed successfully');
    } catch (err) {
      console.error('Failed to seed database:', err);
      process.exit(1);
    }
  }
}

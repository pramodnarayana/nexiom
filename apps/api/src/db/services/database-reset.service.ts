import { Injectable } from '@nestjs/common';
import { EnvironmentGuardService } from './environment-guard.service.js';
import { TenantSchemaService } from './tenant-schema.service.js';
import { MigrationRunnerService } from '../infrastructure/migration-runner.service.js';
import { SystemSeederService } from './system-seeder.service.js';

@Injectable()
export class DatabaseResetService {
  constructor(
    private readonly environmentGuard: EnvironmentGuardService,
    private readonly tenantSchema: TenantSchemaService,
    private readonly migrationRunner: MigrationRunnerService,
    private readonly systemSeeder: SystemSeederService,
  ) {}

  /**
   * Fresh install: Drop everything + Migrate + Seed
   * Complete database rebuild
   */
  async fresh(): Promise<void> {
    this.environmentGuard.assertSafeEnvironment();
    console.log('🆕 Fresh database install...\n');

    await this.tenantSchema.dropAll();
    console.log();

    await this.migrationRunner.migrateAllSchemas();
    console.log();

    await this.systemSeeder.seed();
    console.log();

    console.log('✅ Fresh install complete!');
  }

  /**
   * Reset: Truncate + Seed
   * Clears data but preserves schema
   */
  async reset(): Promise<void> {
    this.environmentGuard.assertSafeEnvironment();
    console.log('🔄 Resetting database...\n');

    await this.tenantSchema.truncateAll();
    console.log();

    await this.systemSeeder.seed();
    console.log();

    console.log('✅ Reset complete!');
  }
}

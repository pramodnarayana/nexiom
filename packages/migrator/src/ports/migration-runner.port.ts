export const MIGRATION_RUNNER = 'MIGRATION_RUNNER';

export interface RunMigrationsOptions {
  migrationsFolder: string;
  searchPath?: string;
}

export interface MigrationRunnerPort {
  /**
   * Run pending migrations for a given database connection and target folder.
   * @param db Client or Pool instance (e.g., from pg or postgres.js)
   * @param options Configuration options
   */
  runMigrations(db: unknown, options: RunMigrationsOptions): Promise<void>;
}

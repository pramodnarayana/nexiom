import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/**
 * AppsConnectorDb represents the generic database connection type provided by the framework to the application connectors.
 * Connectors use this to execute raw SQL queries or built schemas without needing to import the monolithic platform DbSchema.
 */
export type AppsConnectorDb = PostgresJsDatabase<Record<string, unknown>>;

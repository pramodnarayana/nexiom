export interface PluginMigrationEvent {
  pluginLocation: string;
  pieceName: string;
  migrationsFolder?: string;
  tenantId?: string;
}

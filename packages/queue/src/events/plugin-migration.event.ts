export interface PluginMigrationEvent {
  pluginLocation: string;
  pieceName: string;
  tenantId?: string;
}

export interface PluginInstallEvent {
  packageName: string;
  version: string;
  workspaceId?: string; // Optional: If provided, marks the workspace piece as INSTALLED
  pieceId?: string;
  requestMetadata?: {
    webhookReceivedAt: string;
    source: string;
  };
}

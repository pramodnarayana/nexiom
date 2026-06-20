import { Injectable, Logger } from '@nestjs/common';
import type { IPluginBootstrapper } from './plugin-bootstrapper.port.js';
import { WorkspacePluginRegistrar } from './workspace-plugin-registrar.js';

@Injectable()
export class PluginMetadataBootstrapper implements IPluginBootstrapper {
  private readonly logger = new Logger(PluginMetadataBootstrapper.name);

  constructor(private readonly registrar: WorkspacePluginRegistrar) {}

  async bootstrap(): Promise<void> {
    this.logger.log('Bootstrapping platform with workspace metadata...');
    await this.registrar.initialize();
  }
}

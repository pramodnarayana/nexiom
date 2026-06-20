import { Injectable, Logger } from '@nestjs/common';
import type { IPluginBootstrapper } from './plugin-bootstrapper.port.js';
import { PluginManagerService } from './plugin-manager.service.js';

@Injectable()
export class PluginRegistryBootstrapper implements IPluginBootstrapper {
  private readonly logger = new Logger(PluginRegistryBootstrapper.name);

  constructor(private readonly pluginManager: PluginManagerService) {}

  async bootstrap(): Promise<void> {
    this.logger.log('Bootstrapping platform with registry sandbox...');
    await this.pluginManager.initializePlugins();
  }
}

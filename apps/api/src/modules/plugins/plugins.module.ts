import { Module } from '@nestjs/common';
import { PluginsController } from './plugins.controller.js';
import { PiecesModule } from '@soopa/piece-registry';

@Module({
  imports: [PiecesModule.forRoot({ anchorUrl: import.meta.url })], // Brings in PluginManagerService
  controllers: [PluginsController],
})
export class PluginsModule {}

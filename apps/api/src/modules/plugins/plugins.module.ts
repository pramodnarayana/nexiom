import { Module } from '@nestjs/common';
import { PluginsController } from './plugins.controller.js';

@Module({
  imports: [], // PiecesModule is global in AppModule
  controllers: [PluginsController],
})
export class PluginsModule {}

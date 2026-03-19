import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module.js';
import { WorkspacesController } from './workspaces.controller.js';
import { WorkspacesService } from './workspaces.service.js';
import { WorkspaceConnectionsController } from './workspace-connections.controller.js';

@Module({
  imports: [DbModule],
  controllers: [WorkspacesController, WorkspaceConnectionsController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}

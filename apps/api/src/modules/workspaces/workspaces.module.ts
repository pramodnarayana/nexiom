import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module.js';
import { WorkspacesController } from './workspaces.controller.js';
import { WorkspacesService } from './workspaces.service.js';
import { WorkspaceConnectionsController } from './workspace-connections.controller.js';
import { CapacityManagerService } from './capacity-manager.service.js';
import { QueueModule } from '@nexiom/queue';

@Module({
  imports: [DbModule, QueueModule],
  controllers: [WorkspacesController, WorkspaceConnectionsController],
  providers: [WorkspacesService, CapacityManagerService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}

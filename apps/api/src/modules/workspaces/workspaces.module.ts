import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module.js';
import { WorkspacesController } from './workspaces.controller.js';
import { WorkspacesService } from './workspaces.service.js';
import { WorkspaceConnectionsController } from './workspace-connections.controller.js';
import { CapacityManagerService } from './capacity-manager.service.js';
import { QueueModule } from '@soopa/queue';
import { SchedulerModule } from '../scheduler/scheduler.module.js';

@Module({
  imports: [DbModule, QueueModule, SchedulerModule],
  controllers: [WorkspacesController, WorkspaceConnectionsController],
  providers: [WorkspacesService, CapacityManagerService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}

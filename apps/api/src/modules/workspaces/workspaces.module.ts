import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module.js';
import { WorkspacesController } from './workspaces.controller.js';
import { WorkspacesService } from './workspaces.service.js';
import { WorkspaceConnectionsController } from './workspace-connections.controller.js';
import { CapacityManagerService } from './capacity-manager.service.js';
import { WorkspaceRepository } from './repositories/workspace.repository.js';
import { WorkspaceProvisionerUseCase } from './use-cases/workspace-provisioner.use-case.js';

import { QueueModule } from '@soopa/queue';
import { SchedulerModule } from '../scheduler/scheduler.module.js';

import { WorkspacePiecesController } from './workspace-pieces.controller.js';

@Module({
  imports: [DbModule, QueueModule, SchedulerModule],
  controllers: [
    WorkspacesController,
    WorkspaceConnectionsController,
    WorkspacePiecesController,
  ],
  providers: [
    WorkspacesService,
    CapacityManagerService,
    WorkspaceRepository,
    WorkspaceProvisionerUseCase,
  ],
  exports: [
    WorkspacesService,
    WorkspaceRepository,
    WorkspaceProvisionerUseCase,
  ],
})
export class WorkspacesModule {}

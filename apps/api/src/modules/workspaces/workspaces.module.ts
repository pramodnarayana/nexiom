import { Module } from '@nestjs/common';
import { DatabaseModule } from '@soopa/database';
import { WorkspacesController } from './workspaces.controller.js';
import { WorkspaceConnectionsController } from './workspace-connections.controller.js';
import { CapacityManagerService } from './capacity-manager.service.js';

// --- Hexagonal Ports ---
import type { WorkspaceRepositoryPort } from './core/ports/outbound/workspace-repository.port.js';

// --- Hexagonal Adapters ---
import { DrizzleWorkspaceRepositoryAdapter } from './adapters/outbound/drizzle-workspace.adapter.js';

// --- Hexagonal Use Cases ---
import {
  CreateWorkspaceUseCase,
  UpdateWorkspaceUseCase,
  DeleteWorkspaceUseCase,
  GetWorkspaceUseCase,
  ListWorkspacesUseCase,
  ListWorkspaceConnectionsUseCase,
} from './core/use-cases/workspace.use-case.js';
import {
  AssignConnectionUseCase,
  UnassignConnectionUseCase,
  GetConnectionForAssignmentUseCase,
  GetConnectionForSyncUseCase,
} from './core/use-cases/connection-assignment.use-case.js';

import { QueueModule } from '@soopa/queue';
import { SchedulerModule } from '../scheduler/scheduler.module.js';

@Module({
  imports: [DatabaseModule, QueueModule, SchedulerModule],
  controllers: [WorkspacesController, WorkspaceConnectionsController],
  providers: [
    CapacityManagerService,

    // --- Adapters ---
    DrizzleWorkspaceRepositoryAdapter,

    // --- Use Cases ---
    {
      provide: CreateWorkspaceUseCase,
      useFactory: (repo: WorkspaceRepositoryPort) =>
        new CreateWorkspaceUseCase(repo),
      inject: [DrizzleWorkspaceRepositoryAdapter],
    },
    {
      provide: UpdateWorkspaceUseCase,
      useFactory: (repo: WorkspaceRepositoryPort) =>
        new UpdateWorkspaceUseCase(repo),
      inject: [DrizzleWorkspaceRepositoryAdapter],
    },
    {
      provide: DeleteWorkspaceUseCase,
      useFactory: (repo: WorkspaceRepositoryPort) =>
        new DeleteWorkspaceUseCase(repo),
      inject: [DrizzleWorkspaceRepositoryAdapter],
    },
    {
      provide: GetWorkspaceUseCase,
      useFactory: (repo: WorkspaceRepositoryPort) =>
        new GetWorkspaceUseCase(repo),
      inject: [DrizzleWorkspaceRepositoryAdapter],
    },
    {
      provide: ListWorkspacesUseCase,
      useFactory: (repo: WorkspaceRepositoryPort) =>
        new ListWorkspacesUseCase(repo),
      inject: [DrizzleWorkspaceRepositoryAdapter],
    },
    {
      provide: ListWorkspaceConnectionsUseCase,
      useFactory: (repo: WorkspaceRepositoryPort) =>
        new ListWorkspaceConnectionsUseCase(repo),
      inject: [DrizzleWorkspaceRepositoryAdapter],
    },
    {
      provide: AssignConnectionUseCase,
      useFactory: (repo: WorkspaceRepositoryPort) =>
        new AssignConnectionUseCase(repo),
      inject: [DrizzleWorkspaceRepositoryAdapter],
    },
    {
      provide: UnassignConnectionUseCase,
      useFactory: (repo: WorkspaceRepositoryPort) =>
        new UnassignConnectionUseCase(repo),
      inject: [DrizzleWorkspaceRepositoryAdapter],
    },
    {
      provide: GetConnectionForAssignmentUseCase,
      useFactory: (repo: WorkspaceRepositoryPort) =>
        new GetConnectionForAssignmentUseCase(repo),
      inject: [DrizzleWorkspaceRepositoryAdapter],
    },
    {
      provide: GetConnectionForSyncUseCase,
      useFactory: (repo: WorkspaceRepositoryPort) =>
        new GetConnectionForSyncUseCase(repo),
      inject: [DrizzleWorkspaceRepositoryAdapter],
    },
  ],
  exports: [],
})
export class WorkspacesModule {}

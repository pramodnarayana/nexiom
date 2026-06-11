import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  AuthGuard,
  PermissionsGuard,
  RequirePermission,
  AuthContext,
  type RequestAuthContext,
} from '@soopa/auth';
import {
  CreateWorkspaceUseCase,
  UpdateWorkspaceUseCase,
  DeleteWorkspaceUseCase,
  GetWorkspaceUseCase,
  ListWorkspacesUseCase,
} from './core/use-cases/workspace.use-cases.js';
import { CreateWorkspace, UpdateWorkspace } from './workspaces.validation.js';
import { requireOrgId } from './workspace.utils.js';
import { isUniqueViolation } from '../../shared/db.utils.js';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('workspaces')
export class WorkspacesController {
  constructor(
    private readonly createWorkspaceUseCase: CreateWorkspaceUseCase,
    private readonly listWorkspacesUseCase: ListWorkspacesUseCase,
    private readonly getWorkspaceUseCase: GetWorkspaceUseCase,
    private readonly updateWorkspaceUseCase: UpdateWorkspaceUseCase,
    private readonly deleteWorkspaceUseCase: DeleteWorkspaceUseCase,
  ) {}

  @Post()
  @RequirePermission('workspaces', 'manage')
  create(
    @AuthContext() auth: RequestAuthContext,
    @Body() body: CreateWorkspace,
  ) {
    return this.createWorkspaceUseCase.execute({
      orgId: requireOrgId(auth),
      name: body.name,
      envType: body.envType ?? 'PRODUCTION',
    });
  }

  @Get()
  @RequirePermission('workspaces', 'read')
  list(@AuthContext() auth: RequestAuthContext) {
    return this.listWorkspacesUseCase.execute(requireOrgId(auth));
  }

  @Get(':id')
  @RequirePermission('workspaces', 'read')
  async findOne(
    @AuthContext() auth: RequestAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const ws = await this.getWorkspaceUseCase.execute(requireOrgId(auth), id);
    if (!ws) throw new NotFoundException('Workspace not found');
    return ws;
  }

  @Patch(':id')
  @RequirePermission('workspaces', 'manage')
  async update(
    @AuthContext() auth: RequestAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateWorkspace,
  ) {
    const orgId = requireOrgId(auth);
    const hasChanges = body.name !== undefined || body.envType !== undefined;
    if (!hasChanges)
      throw new BadRequestException('No updatable fields provided.');

    try {
      const updated = await this.updateWorkspaceUseCase.execute(
        orgId,
        id,
        body,
      );
      if (!updated) throw new NotFoundException('Workspace not found');
      return updated;
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'Workspace with this name already exists in this organisation.',
        );
      }
      throw err;
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('workspaces', 'manage')
  async remove(
    @AuthContext() auth: RequestAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const orgId = requireOrgId(auth);
    const deleted = await this.deleteWorkspaceUseCase.execute(orgId, id);
    if (!deleted) throw new NotFoundException('Workspace not found');
  }
}

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
} from '@nestjs/common';
import {
  AuthGuard,
  PermissionsGuard,
  RequirePermission,
  AuthContext,
  type RequestAuthContext,
} from '@soopa/auth';
import { WorkspacesService } from './workspaces.service.js';
import { CreateWorkspace, UpdateWorkspace } from './workspaces.validation.js';
import { requireOrgId } from './workspace.utils.js';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  @RequirePermission('workspaces', 'manage')
  create(
    @AuthContext() auth: RequestAuthContext,
    @Body() body: CreateWorkspace,
  ) {
    return this.workspacesService.create(requireOrgId(auth), body);
  }

  @Get()
  @RequirePermission('workspaces', 'read')
  list(@AuthContext() auth: RequestAuthContext) {
    return this.workspacesService.list(requireOrgId(auth));
  }

  @Get(':id')
  @RequirePermission('workspaces', 'read')
  findOne(
    @AuthContext() auth: RequestAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.workspacesService.findOne(requireOrgId(auth), id);
  }

  @Patch(':id')
  @RequirePermission('workspaces', 'manage')
  update(
    @AuthContext() auth: RequestAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateWorkspace,
  ) {
    return this.workspacesService.update(requireOrgId(auth), id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('workspaces', 'manage')
  remove(
    @AuthContext() auth: RequestAuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.workspacesService.remove(requireOrgId(auth), id);
  }
}

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';
import { AuthGuard } from '@nexiom/auth';

@Controller('workspaces')
@UseGuards(AuthGuard)
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  async createWorkspace(
    @Body() body: { name: string; slug: string; tenantId: string },
  ) {
    // In a full implementation, we would verify the user has admin rights in 'tenantId'
    return this.workspacesService.createWorkspace(
      body.tenantId,
      body.name,
      body.slug,
    );
  }

  @Get()
  async getWorkspaces(@Query('tenantId') tenantId: string) {
    if (!tenantId) {
      throw new Error('tenantId query parameter is required');
    }
    return this.workspacesService.getWorkspacesForTenant(tenantId);
  }

  @Get(':slug')
  async getWorkspaceBySlug(
    @Query('tenantId') tenantId: string,
    @Param('slug') slug: string,
  ) {
    if (!tenantId) {
      throw new Error('tenantId query parameter is required');
    }
    return this.workspacesService.getWorkspaceBySlug(tenantId, slug);
  }
}

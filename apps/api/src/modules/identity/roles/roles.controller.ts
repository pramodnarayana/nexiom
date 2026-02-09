import { Controller, Get, UseGuards, Query, Inject } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { ROLE_PROVIDER } from '@nexiom/identity';
import type { IRoleProvider } from '@nexiom/identity';

@Controller('roles')
@UseGuards(AuthGuard, PermissionsGuard)
export class RolesController {
  constructor(
    @Inject(ROLE_PROVIDER) private readonly roleProvider: IRoleProvider,
  ) {}

  @Get()
  // Decide permission: users can see roles? or just admins?
  // Usually anyone who can manage users needs to see roles.
  // Or maybe just authenticated users?
  // Let's require a basic permission or just Auth if we filter by scope.
  // For now, let's say 'users:read' or 'system_users:read' depending on context?
  // Simpler: Allow authenticated, but filter content.
  async findAll(@Query('scope') scope?: 'system' | 'organization') {
    const roles = await this.roleProvider.findAll({ scope });
    return { data: roles };
  }
}

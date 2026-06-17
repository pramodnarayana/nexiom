import {
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  UseGuards,
  Query,
  Inject,
  ParseEnumPipe,
  Controller,
  NotFoundException,
} from '@nestjs/common';
import {
  AuthGuard,
  PermissionsGuard,
  RequirePermission,
  AuthContext,
  type RequestAuthContext,
} from '@soopa/auth';
import { ROLE_REPOSITORY, RoleScope } from '@soopa/identity';
import type {
  RoleRepositoryPort,
  CreateRoleInput,
  UpdateRoleInput,
} from '@soopa/identity';
import { filterRolesForRequester } from '@soopa/identity/utils/role-visibility';

@Controller('roles')
@UseGuards(AuthGuard, PermissionsGuard)
export class RolesController {
  constructor(
    @Inject(ROLE_REPOSITORY) private readonly roleProvider: RoleRepositoryPort,
  ) {}

  @Get()
  @RequirePermission('roles', 'read')
  async findAll(
    @AuthContext() ctx: RequestAuthContext,
    @Query('scope', new ParseEnumPipe(RoleScope, { optional: true }))
    scope?: RoleScope,
  ) {
    const roles = await this.roleProvider.findAll({ scope });
    return {
      data: filterRolesForRequester(roles, ctx.user?.memberRole ?? ''),
    };
  }

  @Post()
  @RequirePermission('roles', 'create')
  async create(@Body() body: CreateRoleInput) {
    const role = await this.roleProvider.create(body);
    return { data: role };
  }

  @Get(':id')
  @RequirePermission('roles', 'read')
  async findById(
    @Param('id') id: string,
    @AuthContext() ctx: RequestAuthContext,
  ) {
    const role = await this.roleProvider.findById(id);
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    const visibleRoles = filterRolesForRequester(
      [role],
      ctx.user?.memberRole ?? '',
    );
    if (visibleRoles.length === 0) {
      throw new NotFoundException('Role not found');
    }

    return { data: role };
  }

  @Put(':id')
  @RequirePermission('roles', 'update')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateRoleInput,
    @AuthContext() ctx: RequestAuthContext,
  ) {
    // Check visibility before updating
    const existingRole = await this.roleProvider.findById(id);
    if (!existingRole) {
      throw new NotFoundException('Role not found');
    }

    const visibleRoles = filterRolesForRequester(
      [existingRole],
      ctx.user?.memberRole ?? '',
    );
    if (visibleRoles.length === 0) {
      throw new NotFoundException('Role not found'); // Hide restricted roles
    }

    const role = await this.roleProvider.update(id, body);
    return { data: role };
  }

  @Delete(':id')
  @RequirePermission('roles', 'delete')
  async delete(
    @Param('id') id: string,
    @AuthContext() ctx: RequestAuthContext,
  ) {
    // Check visibility before deleting
    const existingRole = await this.roleProvider.findById(id);
    if (!existingRole) {
      throw new NotFoundException('Role not found');
    }

    const visibleRoles = filterRolesForRequester(
      [existingRole],
      ctx.user?.memberRole ?? '',
    );
    if (visibleRoles.length === 0) {
      throw new NotFoundException('Role not found'); // Hide restricted roles
    }

    await this.roleProvider.delete(id);
    return { data: { deleted: true } };
  }
}

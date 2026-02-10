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
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import {
  ROLE_PROVIDER,
  RoleScope,
  CreateRoleInput,
  UpdateRoleInput,
} from '@nexiom/identity';
import type { IRoleProvider } from '@nexiom/identity';

@Controller('roles')
@UseGuards(AuthGuard, PermissionsGuard)
export class RolesController {
  constructor(
    @Inject(ROLE_PROVIDER) private readonly roleProvider: IRoleProvider,
  ) {}

  @Get()
  @RequirePermission('roles', 'read')
  async findAll(
    @Query('scope', new ParseEnumPipe(RoleScope, { optional: true }))
    scope?: RoleScope,
  ) {
    const roles = await this.roleProvider.findAll({ scope });
    return { data: roles };
  }

  @Post()
  @RequirePermission('roles', 'create')
  async create(@Body() body: CreateRoleInput) {
    const role = await this.roleProvider.create(body);
    return { data: role };
  }

  @Get(':id')
  @RequirePermission('roles', 'read')
  async findById(@Param('id') id: string) {
    const role = await this.roleProvider.findById(id);
    return { data: role };
  }

  @Put(':id')
  @RequirePermission('roles', 'update')
  async update(@Param('id') id: string, @Body() body: UpdateRoleInput) {
    const role = await this.roleProvider.update(id, body);
    return { data: role };
  }

  @Delete(':id')
  @RequirePermission('roles', 'delete')
  async delete(@Param('id') id: string) {
    await this.roleProvider.delete(id);
    return { data: { deleted: true } };
  }
}

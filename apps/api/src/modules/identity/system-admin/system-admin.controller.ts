import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Inject,
  Query,
  BadRequestException,
  NotFoundException,
  UsePipes,
} from '@nestjs/common';
import {
  AUTH_PROVIDER,
  IAuthProvider,
  USER_PROVIDER,
  IUserProvider,
  TENANT_PROVIDER,
  ITenantProvider,
  ROLE_PROVIDER,
  IRoleProvider,
} from '@nexiom/identity';
import {
  AuthContext,
  RequestAuthContext,
} from '../auth/auth-context.decorator';
import {
  getRequiredAdminRoleId,
  getRequiredSystemTenantId,
} from '../../../constants';
import {
  CreateTenantValidation,
  UpdateTenantValidation,
  CreateUserValidation,
  CreateUserDto,
  UpdateUserValidation,
  buildCreateSystemInvitationSchema,
  CreateSystemInvitationDto,
} from './system-admin.validation';
import { LazyZodValidationPipe } from '../../../common/pipes/lazy-zod-validation.pipe';
import { RequirePermission } from '../auth/require-permission.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AuthGuard } from '../auth/auth.guard';

@Controller('admin')
@UseGuards(AuthGuard, PermissionsGuard)
export class SystemAdminController {
  constructor(
    @Inject(AUTH_PROVIDER) private readonly authProvider: IAuthProvider,
    @Inject(USER_PROVIDER) private readonly userProvider: IUserProvider,
    @Inject(TENANT_PROVIDER) private readonly tenantProvider: ITenantProvider,
    @Inject(ROLE_PROVIDER) private readonly roleProvider: IRoleProvider,
  ) {}

  @Post('users/:id/invite')
  @RequirePermission('system_users', 'create')
  async inviteUser(
    @Param('id') id: string,
    @AuthContext() ctx: RequestAuthContext,
  ) {
    const user = await this.userProvider.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Create System Invitation (OrgId = null)
    await this.authProvider.createInvitation({
      email: user.email,
      role: getRequiredAdminRoleId(),
      organizationId: null, // System Invite
      inviterId: ctx.user.id,
    });

    return { success: true };
  }

  @Post('invitations')
  @RequirePermission('system_users', 'create')
  @UsePipes(new LazyZodValidationPipe(buildCreateSystemInvitationSchema))
  async createSystemInvitation(
    @Body() body: CreateSystemInvitationDto,
    @AuthContext() ctx: RequestAuthContext,
  ) {
    // Validate Role Existence
    const roleExists = await this.roleProvider.findById(body.role);
    if (!roleExists) {
      throw new BadRequestException(`Role '${body.role}' not found`);
    }

    const invitation = await this.authProvider.createInvitation({
      email: body.email,
      role: body.role, // Zod handles default
      organizationId: getRequiredSystemTenantId(), // System tenant (Nexiom Platform)
      inviterId: ctx.user.id,
      headers: ctx.headers, // Required by Better Auth
    });

    return invitation;
  }

  @Post('tenants')
  @RequirePermission('system_tenants', 'manage')
  async createTenant(@Body() input: CreateTenantValidation) {
    // Check if slug exists
    const existing = await this.tenantProvider.findBySlug(input.slug);

    if (existing) {
      throw new BadRequestException('Slug is already taken by another tenant');
    }

    const tenant = await this.tenantProvider.createTenant({
      name: input.name,
      slug: input.slug,
      logo: input.logo,
    });

    return tenant;
  }

  @Post('users')
  @RequirePermission('system_users', 'manage')
  async createUser(@Body() input: CreateUserValidation) {
    // Type the validated input properly
    const data: CreateUserDto = input as CreateUserDto;

    // Check if email already exists
    const existing = await this.userProvider.findByEmail(data.email);

    if (existing) {
      throw new BadRequestException('User with this email already exists');
    }

    // Validate Role Existence
    if (data.role) {
      const roleExists = await this.roleProvider.findById(data.role);
      if (!roleExists) {
        throw new BadRequestException(`Role '${data.role}' not found`);
      }
    }

    // Now uses single-step creation via Adapter logic
    const user = await this.userProvider.create({
      ...data,
    });

    return user;
  }

  @Patch('tenants/:id')
  @RequirePermission('system_tenants', 'manage')
  async updateTenant(
    @Param('id') id: string,
    @Body() input: UpdateTenantValidation,
  ) {
    const tenant = await this.tenantProvider.findById(id);

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    // Check slug uniqueness if changing
    if (input.slug && input.slug !== tenant.slug) {
      const existing = await this.tenantProvider.findBySlug(input.slug);

      if (existing && existing.id !== id) {
        throw new BadRequestException(
          'Slug is already taken by another tenant',
        );
      }
    }

    if (Object.keys(input).length === 0) {
      throw new BadRequestException('No fields to update');
    }

    const updated = await this.tenantProvider.update(id, input);
    return updated;
  }

  @Delete('tenants/:id')
  @RequirePermission('system_tenants', 'manage')
  async deleteTenant(@Param('id') id: string) {
    const tenant = await this.tenantProvider.findById(id);

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    await this.tenantProvider.delete(id);

    return { success: true };
  }

  @Get('users')
  @RequirePermission('system_users', 'read')
  async listUsers(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '10',
    @Query('search') search?: string,
  ) {
    const MAX_PAGE_SIZE = 100;
    // Basic pagination (Convert to Number safely)
    const p = Math.max(1, Number.parseInt(page) || 1);
    const limit = Math.max(
      1,
      Math.min(MAX_PAGE_SIZE, Number.parseInt(pageSize) || 10),
    );

    const result = await this.userProvider.findAll({
      page: p,
      limit,
      search,
      tenantId: getRequiredSystemTenantId(), // Scope to System Tenant (Platform Admins only)
    });

    return result; // Envelope { data, total } matches
  }

  @Patch('users/:id')
  @RequirePermission('system_users', 'manage')
  async updateUser(
    @Param('id') id: string,
    @Body() input: UpdateUserValidation,
  ) {
    const user = await this.userProvider.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check email uniqueness if changing
    if (input.email && input.email !== user.email) {
      const existing = await this.userProvider.findByEmail(input.email);

      if (existing && existing.id !== id) {
        throw new BadRequestException('Email already in use');
      }
    }

    if (Object.keys(input).length === 0) {
      throw new BadRequestException('No fields to update');
    }

    const updated = await this.userProvider.update(id, input);
    return updated;
  }

  @Get('users/:id')
  @RequirePermission('system_users', 'read')
  async getUser(@Param('id') id: string) {
    const user = await this.userProvider.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  @Delete('users/:id')
  @RequirePermission('system_users', 'manage')
  async deleteUser(@Param('id') id: string) {
    const user = await this.userProvider.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Safety: Prevent deleting the last platform admin
    // TODO: Implement safety check for last Platform Administrator using PermissionProvider count

    await this.userProvider.delete(id);

    return { success: true };
  }

  @Get('tenants')
  @RequirePermission('system_tenants', 'read')
  async listTenants(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '10',
  ) {
    const MAX_PAGE_SIZE = 100;
    const p = Math.max(1, Number.parseInt(page) || 1);
    const limit = Math.max(
      1,
      Math.min(MAX_PAGE_SIZE, Number.parseInt(pageSize) || 10),
    );

    const result = await this.tenantProvider.findAll({
      page: p,
      limit,
    });

    return result; // Envelope { data, total } matches
  }

  @Get('tenants/:id')
  @RequirePermission('system_tenants', 'read')
  async getTenant(@Param('id') id: string) {
    // ... code ...
    const tenant = await this.tenantProvider.findById(id);

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return tenant;
  }
}

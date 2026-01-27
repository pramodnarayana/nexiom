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
  Headers as RequestHeaders,
} from '@nestjs/common';
import {
  AUTH_PROVIDER,
  IAuthProvider,
  USER_PROVIDER,
  IUserProvider,
  TENANT_PROVIDER,
  ITenantProvider,
} from '@nexiom/identity';
import {
  CreateTenantValidation,
  UpdateTenantValidation,
  UpdateUserValidation,
  CreateUserValidation,
  CreateSystemInvitationValidation,
} from './system-admin.validation';
import { RequirePermission } from '../auth/require-permission.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AuthGuard } from '../auth/auth.guard';

@Controller('admin')
export class SystemAdminController {
  constructor(
    @Inject(AUTH_PROVIDER) private readonly authProvider: IAuthProvider,
    @Inject(USER_PROVIDER) private readonly userProvider: IUserProvider,
    @Inject(TENANT_PROVIDER) private readonly tenantProvider: ITenantProvider,
  ) {}

  @Post('users/:id/invite')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('system_users', 'invite')
  async inviteUser(
    @Param('id') id: string,
    @RequestHeaders() headers: Record<string, string>,
  ) {
    const user = await this.userProvider.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const webHeaders = this.toWebHeaders(headers);

    // Get current admin ID from session (via Headers -> BetterAuth)
    const session = await this.authProvider.getSessionFromHeaders(webHeaders);

    if (!session?.user) {
      throw new BadRequestException('Unauthorized');
    }

    // Create System Invitation (OrgId = null)
    await this.authProvider.createInvitation({
      email: user.email,
      role: user.systemRole || 'platform_user',
      organizationId: null, // System Invite
      inviterId: session.user.id,
    });

    return { success: true };
  }

  @Post('invitations')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('system_users', 'invite')
  async createSystemInvitation(
    @Body() body: CreateSystemInvitationValidation,
    @RequestHeaders() headers: Record<string, string>,
  ) {
    const webHeaders = this.toWebHeaders(headers);

    // Get current admin ID from session
    const session = await this.authProvider.getSessionFromHeaders(webHeaders);

    if (!session?.user) {
      throw new BadRequestException('Unauthorized');
    }

    const invitation = await this.authProvider.createInvitation({
      email: body.email,
      role: body.role, // Zod handles default
      organizationId: null, // System invitation
      inviterId: session.user.id,
    });

    return invitation;
  }

  private toWebHeaders(headers: Record<string, string>): Headers {
    const webHeaders = new Headers();
    Object.entries(headers).forEach(([key, value]) => {
      if (value) {
        webHeaders.append(key, value);
      }
    });
    return webHeaders;
  }

  @Post('tenants')
  @UseGuards(AuthGuard, PermissionsGuard)
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
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('system_users', 'manage')
  async createUser(@Body() input: CreateUserValidation) {
    // Check if email already exists
    const existing = await this.userProvider.findByEmail(input.email);

    if (existing) {
      throw new BadRequestException('User with this email already exists');
    }

    // Now uses single-step creation via Adapter logic
    const user = await this.userProvider.create({
      ...input,
    });

    return user;
  }

  @Patch('tenants/:id')
  @UseGuards(AuthGuard, PermissionsGuard)
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
  @UseGuards(AuthGuard, PermissionsGuard)
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
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('system_users', 'read')
  async listUsers(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '10',
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
    }); // No tenantId -> Global list

    return result; // Envelope { data, total } matches
  }

  @Patch('users/:id')
  @UseGuards(AuthGuard, PermissionsGuard)
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
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('system_users', 'read')
  async getUser(@Param('id') id: string) {
    const user = await this.userProvider.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  @Delete('users/:id')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('system_users', 'manage')
  async deleteUser(@Param('id') id: string) {
    const user = await this.userProvider.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Safety: Prevent deleting the last platform admin
    if (user.systemRole === 'platform_admin') {
      const adminCount = await this.userProvider.count({
        systemRole: 'platform_admin',
      });

      // The count includes the current target user.
      // A count of 1 means this is the LAST admin left.
      // Therefore, we must prevent deletion if count <= 1.
      if (adminCount <= 1) {
        throw new BadRequestException(
          'Cannot delete the last Platform Administrator',
        );
      }
    }

    await this.userProvider.delete(id);

    return { success: true };
  }

  @Get('tenants')
  @UseGuards(AuthGuard, PermissionsGuard)
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
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('system_tenants', 'read')
  async getTenant(@Param('id') id: string) {
    const tenant = await this.tenantProvider.findById(id);

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return tenant;
  }
}

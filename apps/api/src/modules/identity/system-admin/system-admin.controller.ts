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
import { SystemAdminGuard } from '../auth/system-admin.guard';
import { PlatformGuard } from '../auth/platform.guard';
import {
  CreateTenantValidation,
  UpdateTenantValidation,
  UpdateUserValidation,
  CreateUserValidation,
  CreateSystemInvitationValidation,
} from './system-admin.validation';

@Controller('admin')
export class SystemAdminController {
  constructor(
    @Inject(AUTH_PROVIDER) private readonly authProvider: IAuthProvider,
    @Inject(USER_PROVIDER) private readonly userProvider: IUserProvider,
    @Inject(TENANT_PROVIDER) private readonly tenantProvider: ITenantProvider,
  ) {}

  @Post('users/:id/invite')
  @UseGuards(SystemAdminGuard)
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

    if (!session || !session.user) {
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
  @UseGuards(SystemAdminGuard)
  async createSystemInvitation(
    @Body() body: CreateSystemInvitationValidation,
    @RequestHeaders() headers: Record<string, string>,
  ) {
    const webHeaders = this.toWebHeaders(headers);

    // Get current admin ID from session
    const session = await this.authProvider.getSessionFromHeaders(webHeaders);

    if (!session || !session.user) {
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
  @UseGuards(SystemAdminGuard)
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
  @UseGuards(SystemAdminGuard)
  async createUser(@Body() input: CreateUserValidation) {
    // Check if email already exists
    const existing = await this.userProvider.findByEmail(input.email);

    if (existing) {
      throw new BadRequestException('User with this email already exists');
    }

    // Adapt input to provider requirement (provider handles ID generation and timestamps)
    const user = await this.userProvider.create({
      ...input,
      // Default systemRole handled by provider or we pass explicitly?
      // create signature: (input: CreateUserInput) -> email, password?, firstName?, lastName?, role?
      // Does CreateUserInput support systemRole?
      // Let's check CreateUserInput interface.
      // It supports role, but not systemRole explicitly in interface file I saw?
      // Wait, let's verify CreateUserInput.
    });
    // Ah, DrizzleUserAdapter delegates to authProvider which delegates to BetterAuth.
    // BetterAuth input usually has role.
    // If 'systemRole' is not in CreateUserInput, we might need to update user AFTER create
    // OR update CreateUserInput.
    // For now, assume provider handles it or update immediately.
    // Let's assume we update immediately if provider doesn't support generic fields in create.
    if (input.systemRole) {
      await this.userProvider.update(user.id, { systemRole: input.systemRole });
      return this.userProvider.findById(user.id);
    }

    return user;
  }

  @Patch('tenants/:id')
  @UseGuards(SystemAdminGuard)
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
  @UseGuards(SystemAdminGuard)
  async deleteTenant(@Param('id') id: string) {
    const tenant = await this.tenantProvider.findById(id);

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    await this.tenantProvider.delete(id);

    return { success: true };
  }

  @Get('users')
  @UseGuards(PlatformGuard)
  async listUsers(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '10',
  ) {
    const MAX_PAGE_SIZE = 100;
    // Basic pagination (Convert to Number safely)
    const p = Math.max(1, parseInt(page) || 1);
    const limit = Math.max(
      1,
      Math.min(MAX_PAGE_SIZE, parseInt(pageSize) || 10),
    );

    const result = await this.userProvider.findAll({
      page: p,
      limit,
    }); // No tenantId -> Global list

    return result; // Envelope { data, total } matches
  }

  @Patch('users/:id')
  @UseGuards(SystemAdminGuard)
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
  @UseGuards(PlatformGuard)
  async getUser(@Param('id') id: string) {
    const user = await this.userProvider.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  @Delete('users/:id')
  @UseGuards(SystemAdminGuard)
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

      // If this user is an admin, and count is 1, they are the last one.
      // However, count() includes this user.
      // Original logic: count where role=admin AND id != target.
      // Provider logic: count where role=admin.
      // So if count <= 1, we prevent delete.
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
  @UseGuards(PlatformGuard)
  async listTenants(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '10',
  ) {
    const MAX_PAGE_SIZE = 100;
    const p = Math.max(1, parseInt(page) || 1);
    const limit = Math.max(
      1,
      Math.min(MAX_PAGE_SIZE, parseInt(pageSize) || 10),
    );

    const result = await this.tenantProvider.findAll({
      page: p,
      limit,
    });

    return result; // Envelope { data, total } matches
  }

  @Get('tenants/:id')
  @UseGuards(PlatformGuard)
  async getTenant(@Param('id') id: string) {
    const tenant = await this.tenantProvider.findById(id);

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return tenant;
  }
}

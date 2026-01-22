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
import { IdentityProvider } from '../auth/identity-provider.abstract';
import { SystemAdminGuard } from '../auth/system-admin.guard';
import { PlatformGuard } from '../auth/platform.guard';
import { DRIZZLE_DB } from '../../db/db.provider';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { desc, count, eq, ne, and } from 'drizzle-orm';
import {
  CreateTenantValidation,
  UpdateTenantValidation,
  UpdateUserValidation,
  CreateUserValidation,
  CreateSystemInvitationValidation,
} from './system-admin.validation';
import { v4 as uuidv4 } from 'uuid';

@Controller('admin')
export class SystemAdminController {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly identityProvider: IdentityProvider,
  ) {}

  @Post('users/:id/invite')
  @UseGuards(SystemAdminGuard)
  async inviteUser(
    @Param('id') id: string,
    @RequestHeaders() headers: Record<string, string>,
  ) {
    const user = await this.db.query.user.findFirst({
      where: eq(schema.user.id, id),
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const webHeaders = this.toWebHeaders(headers);

    // Get current admin ID from session (via Headers -> BetterAuth)
    const session =
      await this.identityProvider.getSessionFromHeaders(webHeaders);
    if (!session || !session.user) {
      throw new BadRequestException('Unauthorized');
    }

    // Create System Invitation (OrgId = null)
    await this.identityProvider.createInvitation({
      email: user.email,
      role: user.systemRole || 'platform_user',
      organizationId: null, // System Invite
      inviterId: session.user.id,
      headers: webHeaders,
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
    const session =
      await this.identityProvider.getSessionFromHeaders(webHeaders);
    if (!session || !session.user) {
      throw new BadRequestException('Unauthorized');
    }

    const invitation = await this.identityProvider.createInvitation({
      email: body.email,
      role: body.role, // Zod handles default
      organizationId: null, // System invitation
      inviterId: session.user.id,
      headers: webHeaders,
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
    const existing = await this.db.query.organization.findFirst({
      where: eq(schema.organization.slug, input.slug),
    });

    if (existing) {
      throw new BadRequestException('Slug is already taken by another tenant');
    }

    const [tenant] = await this.db
      .insert(schema.organization)
      .values({
        id: uuidv4(),
        name: input.name,
        slug: input.slug,
        logo: input.logo,
        createdAt: new Date(),
        status: 'active',
      })
      .returning();

    return tenant;
  }

  @Post('users')
  @UseGuards(SystemAdminGuard)
  async createUser(@Body() input: CreateUserValidation) {
    // Check if email already exists
    const existing = await this.db.query.user.findFirst({
      where: eq(schema.user.email, input.email),
    });

    if (existing) {
      throw new BadRequestException('User with this email already exists');
    }

    const [user] = await this.db
      .insert(schema.user)
      .values({
        id: uuidv4(),
        name: input.name,
        email: input.email,
        systemRole: input.systemRole || 'platform_user',
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return user;
  }

  @Patch('tenants/:id')
  @UseGuards(SystemAdminGuard)
  async updateTenant(
    @Param('id') id: string,
    @Body() input: UpdateTenantValidation,
  ) {
    const tenant = await this.db.query.organization.findFirst({
      where: eq(schema.organization.id, id),
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    // Check slug uniqueness if changing
    if (input.slug && input.slug !== tenant.slug) {
      const existing = await this.db.query.organization.findFirst({
        where: and(
          eq(schema.organization.slug, input.slug),
          ne(schema.organization.id, id),
        ),
      });

      if (existing) {
        throw new BadRequestException(
          'Slug is already taken by another tenant',
        );
      }
    }

    const updatePayload: Partial<typeof schema.organization.$inferInsert> = {};
    if (input.name !== undefined) updatePayload.name = input.name;
    if (input.slug !== undefined) updatePayload.slug = input.slug;
    if (input.logo !== undefined) updatePayload.logo = input.logo;
    if (input.status !== undefined) updatePayload.status = input.status;
    if (input.metadata !== undefined)
      updatePayload.metadata = JSON.stringify(input.metadata);

    if (Object.keys(updatePayload).length === 0) {
      throw new BadRequestException('No fields to update');
    }

    const [updated] = await this.db
      .update(schema.organization)
      .set(updatePayload)
      .where(eq(schema.organization.id, id))
      .returning();

    return updated;
  }

  @Delete('tenants/:id')
  @UseGuards(SystemAdminGuard)
  async deleteTenant(@Param('id') id: string) {
    const tenant = await this.db.query.organization.findFirst({
      where: eq(schema.organization.id, id),
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    await this.db.transaction(async (tx) => {
      // Hard delete dependent records and organization
      await tx
        .delete(schema.member)
        .where(eq(schema.member.organizationId, id));
      await tx
        .delete(schema.invitation)
        .where(eq(schema.invitation.organizationId, id));
      await tx
        .delete(schema.organization)
        .where(eq(schema.organization.id, id));
    });

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
    const offset = (p - 1) * limit;

    const users = await this.db.query.user.findMany({
      limit,
      offset,
      orderBy: (users, { desc }) => [desc(users.createdAt)],
    });

    // Total count for pagination
    const totalResult = await this.db
      .select({ count: count() })
      .from(schema.user);
    const total = Number(totalResult[0]?.count || 0);

    return {
      // Envelope
      data: users,
      total,
    };
  }

  @Patch('users/:id')
  @UseGuards(SystemAdminGuard)
  async updateUser(
    @Param('id') id: string,
    @Body() input: UpdateUserValidation,
  ) {
    const user = await this.db.query.user.findFirst({
      where: eq(schema.user.id, id),
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check email uniqueness if changing
    if (input.email && input.email !== user.email) {
      const existing = await this.db.query.user.findFirst({
        where: and(eq(schema.user.email, input.email), ne(schema.user.id, id)),
      });

      if (existing) {
        throw new BadRequestException('Email already in use');
      }
    }

    const updatePayload: Partial<typeof schema.user.$inferInsert> = {};
    if (input.name !== undefined) updatePayload.name = input.name;
    if (input.systemRole !== undefined)
      updatePayload.systemRole = input.systemRole;
    if (input.email !== undefined) updatePayload.email = input.email;
    if (input.emailVerified !== undefined)
      updatePayload.emailVerified = input.emailVerified;

    if (Object.keys(updatePayload).length === 0) {
      throw new BadRequestException('No fields to update');
    }

    try {
      const [updated] = await this.db
        .update(schema.user)
        .set(updatePayload)
        .where(eq(schema.user.id, id))
        .returning();

      return updated;
    } catch (error) {
      // Catch race conditions for unique constraints
      if (
        error instanceof Error &&
        (error.message.includes('unique') ||
          error.message.includes('duplicate'))
      ) {
        throw new BadRequestException('Email already in use');
      }
      throw error;
    }
  }

  @Get('users/:id')
  @UseGuards(PlatformGuard)
  async getUser(@Param('id') id: string) {
    const user = await this.db.query.user.findFirst({
      where: eq(schema.user.id, id),
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  @Delete('users/:id')
  @UseGuards(SystemAdminGuard)
  async deleteUser(@Param('id') id: string) {
    const user = await this.db.query.user.findFirst({
      where: eq(schema.user.id, id),
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Safety: Prevent deleting the last platform admin
    if (user.systemRole === 'platform_admin') {
      const adminCountResult = await this.db
        .select({ count: count() })
        .from(schema.user)
        .where(
          and(
            eq(schema.user.systemRole, 'platform_admin'),
            ne(schema.user.id, id),
          ),
        );

      const otherAdmins = Number(adminCountResult[0]?.count || 0);
      if (otherAdmins === 0) {
        throw new BadRequestException(
          'Cannot delete the last Platform Administrator',
        );
      }
    }

    // Transactional cleanup
    await this.db.transaction(async (tx) => {
      // 1. Delete memberships
      await tx.delete(schema.member).where(eq(schema.member.userId, id));

      // 2. Delete invitations
      // - Created by this user (Inviter)
      await tx
        .delete(schema.invitation)
        .where(eq(schema.invitation.inviterId, id));

      // - Sent TO this user's email (Recipient)
      // Note: We use user.email here, which we fetched above.
      await tx
        .delete(schema.invitation)
        .where(eq(schema.invitation.email, user.email));

      // 3. Delete session/account/etc (BetterAuth handles this typically if cascading, but we do manual for safety)
      await tx.delete(schema.session).where(eq(schema.session.userId, id));
      await tx.delete(schema.account).where(eq(schema.account.userId, id));

      // 4. Delete user
      await tx.delete(schema.user).where(eq(schema.user.id, id));
    });

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
    const offset = (p - 1) * limit;

    const tenantsData = await this.db
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
        slug: schema.organization.slug,
        createdAt: schema.organization.createdAt,
        logo: schema.organization.logo,
        metadata: schema.organization.metadata,
        updatedAt: schema.organization.updatedAt,
        status: schema.organization.status, // Included status
        userCount: count(schema.member.id),
      })
      .from(schema.organization)
      .leftJoin(
        schema.member,
        eq(schema.organization.id, schema.member.organizationId),
      )
      .groupBy(schema.organization.id)
      .limit(limit)
      .offset(offset)
      .orderBy(desc(schema.organization.createdAt))
      .execute();

    // Total count of tenants
    const totalResult = await this.db
      .select({ count: count() })
      .from(schema.organization);
    const total = Number(totalResult[0]?.count || 0);

    return {
      data: tenantsData.map((t) => ({
        ...t,
        userCount: Number(t.userCount),
      })),
      total,
    };
  }

  @Get('tenants/:id')
  @UseGuards(PlatformGuard)
  async getTenant(@Param('id') id: string) {
    const [tenant] = await this.db
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
        slug: schema.organization.slug,
        createdAt: schema.organization.createdAt,
        logo: schema.organization.logo,
        metadata: schema.organization.metadata,
        updatedAt: schema.organization.updatedAt,
        status: schema.organization.status,
      })
      .from(schema.organization)
      .where(eq(schema.organization.id, id))
      .limit(1)
      .execute();

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return tenant;
  }
}

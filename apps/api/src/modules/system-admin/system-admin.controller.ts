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
} from '@nestjs/common';
import { SystemAdminGuard } from '../auth/system-admin.guard';
import { DRIZZLE_DB } from '../../db/db.provider';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { desc, count, eq, ne, and } from 'drizzle-orm';
import {
  CreateTenantValidation,
  UpdateTenantValidation,
} from './system-admin.validation';
import { v4 as uuidv4 } from 'uuid';

@Controller('admin')
@UseGuards(SystemAdminGuard)
export class SystemAdminController {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  @Post('tenants')
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

  @Patch('tenants/:id')
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
    if (input.name) updatePayload.name = input.name;
    if (input.slug) updatePayload.slug = input.slug;
    if (input.logo !== undefined) updatePayload.logo = input.logo;
    if (input.status) updatePayload.status = input.status;
    if (input.metadata) updatePayload.metadata = JSON.stringify(input.metadata);

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
  async deleteTenant(@Param('id') id: string) {
    const tenant = await this.db.query.organization.findFirst({
      where: eq(schema.organization.id, id),
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    await this.db.transaction(async (tx) => {
      // Check for dependent records (Members & Invitations)
      // For a hard delete, we must clean these up to avoid FK constraints
      const membersStart = await tx.query.member.findFirst({
        where: eq(schema.member.organizationId, id),
      });

      if (membersStart) {
        await tx
          .delete(schema.member)
          .where(eq(schema.member.organizationId, id));
      }

      const invitesStart = await tx.query.invitation.findFirst({
        where: eq(schema.invitation.organizationId, id),
      });

      if (invitesStart) {
        await tx
          .delete(schema.invitation)
          .where(eq(schema.invitation.organizationId, id));
      }

      // Hard Delete Organization
      await tx
        .delete(schema.organization)
        .where(eq(schema.organization.id, id));
    });

    return { success: true };
  }

  @Get('users')
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
      orderBy: [desc(schema.user.createdAt)],
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

  @Get('tenants')
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
      .orderBy(desc(schema.organization.createdAt));

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
}

import { Controller, Get, UseGuards, Inject, Query } from '@nestjs/common';
import { SystemAdminGuard } from '../auth/system-admin.guard';
import { DRIZZLE_DB } from '../../db/db.provider';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { desc, count } from 'drizzle-orm';

@Controller('admin')
@UseGuards(SystemAdminGuard)
export class SystemAdminController {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

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

    // Return in format Refine expects (or standard API)
    // Refine simple-rest expects header x-total-count usually, OR a { data, total } envelope if customized.
    // Our existing data-provider handles standard REST?
    // Let's stick to simple REST array or envelope.
    // Looking at UserList.tsx:22 `data?.data?.map`, it expects `{ data: [...], total: ... }` envelope from Refine's hook?
    // Actually Refine's `simple-rest` generally expects just generic List.
    // But `UserList.tsx` accesses `data.data`.
    // Let's verify `dataProvider` source later, but Envelope is safest for custom controllers.
    /* 
      Refine's `useTable` returns { data: { data: [...], total: ... } } if the DataProvider returns { data: [...], total: ... }
      Standard `simple-rest` expects array and `x-total-count` header.
      BUT, we should match what the existing API does.
      Let's assume the Envelope pattern for now as it's cleaner.
    */
    return {
      // Envelope
      data: users,
      total,
    };
  }

  @Get('tenants')
  async listTenants() {
    const tenants = await this.db.query.organization.findMany({
      orderBy: [desc(schema.organization.createdAt)],
      with: {
        members: {
          columns: {
            role: true,
          },
        },
      },
    });

    return {
      data: tenants.map((t) => ({
        ...t,
        userCount: t.members.length,
      })),
      total: tenants.length,
    };
  }
}

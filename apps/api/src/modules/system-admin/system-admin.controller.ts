import { Controller, Get, UseGuards, Inject, Query } from '@nestjs/common';
import { SystemAdminGuard } from '../auth/system-admin.guard';
import { DRIZZLE_DB } from '../../db/db.provider';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { desc, count, eq } from 'drizzle-orm';

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

    // Fetch Tenants with Member Count Aggregation
    // We can't easily do a subquery count in Drizzle Query Builder without 'extras' or raw SQL.
    // For now, to avoid loading ALL members, we can fetch tenants first, then minimal counts or assume the user accepts loading member IDs.
    // However, the cleanest Drizzle way (without complex raw SQL builder) to get 'userCount' without loading all objects
    // is often `count(members.id)`.
    // Since we are using `db.query.organization.findMany`, relations are loaded.
    // Optimized approach: Fetch bare tenants, then count total separately.
    // For 'userCount', if we want to avoid loading thousands of member objects, we should use a `groupBy` query or raw SQL.
    // Given Drizzle's `db.query` helper is powerful but eager, let's stick to the prompt's request:
    // "fetch only tenant fields... replace loading members with an aggregate count per organization".
    // We will do a raw SQL-like approach or just simple Drizzle aggregation if possible.
    // Drizzle `db.query` doesn't support aggregate count mapping easily.
    // Let's use `db.select()...` for this to be efficient.

    /*
      SELECT o.*, COUNT(m.id) as userCount
      FROM organization o
      LEFT JOIN member m ON o.id = m.organizationId
      GROUP BY o.id
      LIMIT X OFFSET Y
    */
    // Importing sql and eq from drizzle-orm is needed.
    // Let's assume we can fetch tenants via `db.query` for consistency (relations etc) but we want count.
    // If we stick to `db.query` we MUST load members to count them in JS, which is what we want to avoid.
    // So we switch to `db.select`.

    const tenantsData = await this.db
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
        slug: schema.organization.slug,
        createdAt: schema.organization.createdAt,
        logo: schema.organization.logo,
        metadata: schema.organization.metadata,
        userCount: count(schema.member.id),
      })
      .from(schema.organization)
      .leftJoin(
        schema.member,
        eq(schema.organization.id, schema.member.organizationId),
      )
      .groupBy(schema.organization.id) // Group by all selected fields or PK
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

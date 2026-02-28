import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  workspaces,
} from '@nexiom/database';
import { eq, and } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

@Injectable()
export class WorkspacesService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  async createWorkspace(tenantId: string, name: string, slug: string) {
    // 1. Check if slug exists for this tenant
    const [existing] = await this.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.tenantId, tenantId), eq(workspaces.slug, slug)))
      .limit(1);

    if (existing) {
      throw new ConflictException(
        'A workspace with this slug already exists for this tenant.',
      );
    }

    // 2. Generate a unique DB schema name
    // Using a portion of tenant UUID to avoid collisions while keeping it relatively readable
    const shortTenant = tenantId.replaceAll('-', '').substring(0, 8);
    const shortSlug = slug.replaceAll(/[^a-z0-9]/gi, '').substring(0, 10);
    const randomSuffix = randomBytes(3).toString('hex');
    const dbSchemaName = `tenant_${shortTenant}_${shortSlug}_${randomSuffix}`;

    // 3. Insert workspace
    const [workspace] = await this.db
      .insert(workspaces)
      .values({
        tenantId,
        name,
        slug,
        dbSchemaName,
      })
      .returning();

    return workspace;
  }

  async getWorkspacesForTenant(tenantId: string) {
    return this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.tenantId, tenantId));
  }

  async getWorkspaceBySlug(tenantId: string, slug: string) {
    const [workspace] = await this.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.tenantId, tenantId), eq(workspaces.slug, slug)))
      .limit(1);

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    return workspace;
  }
}

import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { eq, and, asc, ne } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  integrationStitches,
  fieldMappings,
  uiWorkspaces,
  dataSources,
  globalRegistryOutbox,
} from '@soopa/database';
import {
  extractPgError,
  isUniqueViolation,
  PG_UNIQUE_VIOLATION,
} from '../../../../shared/db.utils.js';
import type { StitchRepositoryPort } from '../../core/ports/outbound/stitch-repository.port.js';

@Injectable()
export class DrizzleStitchRepositoryAdapter implements StitchRepositoryPort {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  async createStitch(
    orgId: string,
    params: {
      name: string;
      workspaceId: string;
      sourceDataSourceId: string;
      destDataSourceId: string;
      canonicalObject?: string;
      targetObject?: string;
      syncCondition?: unknown[];
      status?: 'ACTIVE' | 'INACTIVE';
      fieldMappings?: {
        sourceCanonical: string;
        mappingRules: unknown[];
      }[];
    },
  ): Promise<{
    stitch: unknown;
    destConnAppName: string;
    destOrganizationId: string | null;
    destAppProfile?: string;
  }> {
    // Verify workspace belongs to org
    const workspace = await this.db.query.uiWorkspaces.findFirst({
      where: and(
        eq(uiWorkspaces.id, params.workspaceId),
        eq(uiWorkspaces.orgId, orgId),
      ),
    });
    if (!workspace) {
      throw new NotFoundException(`Workspace ${params.workspaceId} not found.`);
    }

    // Verify destination connection belongs to org
    const destConn = await this.db
      .select()
      .from(dataSources)
      .where(
        and(
          eq(dataSources.id, params.destDataSourceId),
          eq(dataSources.tenantId, orgId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);

    if (!destConn) {
      throw new NotFoundException(
        `Data source ${params.destDataSourceId} not found.`,
      );
    }

    let stitch: typeof integrationStitches.$inferSelect;
    try {
      stitch = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(integrationStitches)
          .values({
            name: params.name,
            orgId,
            workspaceId: params.workspaceId,
            sourceDataSourceId: params.sourceDataSourceId,
            destDataSourceId: params.destDataSourceId,
            canonicalObject: params.canonicalObject || '',
            targetObject: params.targetObject || '',
            ...(params.syncCondition !== undefined && {
              syncCondition: params.syncCondition,
            }),
            ...(params.status !== undefined && { status: params.status }),
          })
          .returning();

        if (!row) {
          throw new InternalServerErrorException(
            'Insert did not return a row.',
          );
        }

        let insertedFms: (typeof fieldMappings.$inferSelect)[] = [];
        if (params.fieldMappings && params.fieldMappings.length > 0) {
          insertedFms = await tx
            .insert(fieldMappings)
            .values(
              params.fieldMappings.map((fm) => ({
                stitchId: row.id,
                sourceCanonical: fm.sourceCanonical,
                mappingRules: fm.mappingRules,
              })),
            )
            .returning();
        }

        await tx.insert(globalRegistryOutbox).values({
          tenantId: orgId,
          entityType: 'INTEGRATION_STITCH',
          entityId: row.id,
          action: 'UPSERT',
          payload: {
            ...row,
            fieldMappings: insertedFms,
          },
        });

        return row;
      });
    } catch (err) {
      const pgErr = extractPgError(err);
      if (pgErr?.code === PG_UNIQUE_VIOLATION) {
        if (pgErr.constraint === 'stitch_name_workspace_unique_idx') {
          throw new ConflictException(
            `A stitch named "${params.name}" already exists in this workspace.`,
          );
        }
        if (pgErr.constraint === 'field_mapping_stitch_canonical_unique_idx') {
          throw new ConflictException(
            'A field mapping for this source object already exists on this stitch.',
          );
        }
      }
      throw err;
    }

    return {
      stitch,
      destConnAppName: destConn.appName,
      destOrganizationId: destConn.organizationId,
      destAppProfile:
        destConn.metadata &&
        typeof destConn.metadata === 'object' &&
        'appProfile' in destConn.metadata
          ? (destConn.metadata.appProfile as string)
          : undefined,
    };
  }

  async listStitches(
    orgId: string,
    workspaceId?: string,
    includeArchived = false,
  ): Promise<unknown[]> {
    const conditions = [eq(integrationStitches.orgId, orgId)];
    if (workspaceId) {
      conditions.push(eq(integrationStitches.workspaceId, workspaceId));
    }
    if (!includeArchived) {
      conditions.push(ne(integrationStitches.status, 'ARCHIVED'));
    }

    return this.db.query.integrationStitches.findMany({
      where: and(...conditions),
      orderBy: [asc(integrationStitches.createdAt)],
    });
  }

  async getStitch(orgId: string, id: string): Promise<unknown> {
    const stitch = await this.db.query.integrationStitches.findFirst({
      where: and(
        eq(integrationStitches.id, id),
        eq(integrationStitches.orgId, orgId),
      ),
      with: { fieldMappings: true },
    });
    if (!stitch) {
      throw new NotFoundException(`Stitch ${id} not found.`);
    }
    return stitch;
  }

  async updateStitch(
    orgId: string,
    id: string,
    params: {
      name?: string;
      status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
      syncCondition?: unknown[];
    },
  ): Promise<unknown> {
    try {
      const updated = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(integrationStitches)
          .set({
            ...(params.name !== undefined && { name: params.name }),
            ...(params.status !== undefined && { status: params.status }),
            ...(params.syncCondition !== undefined && {
              syncCondition: params.syncCondition,
            }),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(integrationStitches.id, id),
              eq(integrationStitches.orgId, orgId),
            ),
          )
          .returning();

        if (!row) {
          throw new NotFoundException(`Stitch ${id} not found.`);
        }

        const mappings = await tx
          .select()
          .from(fieldMappings)
          .where(eq(fieldMappings.stitchId, row.id));

        await tx.insert(globalRegistryOutbox).values({
          tenantId: orgId,
          entityType: 'INTEGRATION_STITCH',
          entityId: row.id,
          action: 'UPSERT',
          payload: {
            ...row,
            fieldMappings: mappings,
          },
        });

        return row;
      });

      return updated;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `A stitch named "${params.name}" already exists in this workspace.`,
        );
      }
      throw err;
    }
  }

  async archiveStitch(orgId: string, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [archived] = await tx
        .update(integrationStitches)
        .set({ status: 'ARCHIVED', updatedAt: new Date() })
        .where(
          and(
            eq(integrationStitches.id, id),
            eq(integrationStitches.orgId, orgId),
          ),
        )
        .returning();

      if (!archived) {
        throw new NotFoundException(`Stitch ${id} not found.`);
      }

      await tx.insert(globalRegistryOutbox).values({
        tenantId: orgId,
        entityType: 'INTEGRATION_STITCH',
        entityId: id,
        action: 'DELETE',
        payload: archived,
      });
    });
  }
}

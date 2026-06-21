import { Injectable, Inject } from "@nestjs/common";
import { sql, eq, and } from "drizzle-orm";
import { integrationStitches, uiWorkspaceDataSources, DATABASE_CONNECTION, type DrizzleDb } from "@soopa/database";
import { StitchRepositoryPort, ActiveStitch } from '../../../shared/ports/stitch.repository.port.js';

@Injectable()
export class DrizzleSharedStitchRepositoryAdapter implements StitchRepositoryPort {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findActiveStitches(
    tenantId: string,
    dataSourceId: string,
    canonicalType: string
  ): Promise<ActiveStitch[]> {
    const stitches = await this.db
      .select({
        id: integrationStitches.id,
        name: integrationStitches.name,
        orgId: integrationStitches.orgId,
        workspaceId: integrationStitches.workspaceId,
        destDataSourceId: integrationStitches.destDataSourceId,
        canonicalObject: integrationStitches.canonicalObject,
        targetObject: integrationStitches.targetObject,
        syncCondition: integrationStitches.syncCondition,
        status: integrationStitches.status,
        createdAt: integrationStitches.createdAt,
        updatedAt: integrationStitches.updatedAt,
        sourceDataSourceId: integrationStitches.sourceDataSourceId,
      })
      .from(integrationStitches)
      .innerJoin(
        uiWorkspaceDataSources,
        and(
          eq(
            integrationStitches.workspaceId,
            uiWorkspaceDataSources.workspaceId,
          ),
          eq(uiWorkspaceDataSources.dataSourceId, dataSourceId),
        ),
      )
      .where(
        and(
          eq(integrationStitches.orgId, tenantId),
          eq(integrationStitches.canonicalObject, canonicalType),
          eq(integrationStitches.status, 'ACTIVE'),
        )
      );

    return stitches;
  }

  async findById(
    tenantId: string,
    stitchId: string
  ): Promise<ActiveStitch | null> {
    const stitches = await this.db
      .select({
        id: integrationStitches.id,
        name: integrationStitches.name,
        orgId: integrationStitches.orgId,
        workspaceId: integrationStitches.workspaceId,
        destDataSourceId: integrationStitches.destDataSourceId,
        canonicalObject: integrationStitches.canonicalObject,
        targetObject: integrationStitches.targetObject,
        syncCondition: integrationStitches.syncCondition,
        status: integrationStitches.status,
        createdAt: integrationStitches.createdAt,
        updatedAt: integrationStitches.updatedAt,
        sourceDataSourceId: integrationStitches.sourceDataSourceId,
      })
      .from(integrationStitches)
      .where(
        and(
          eq(integrationStitches.id, stitchId),
          eq(integrationStitches.orgId, tenantId),
        )
      )
      .limit(1);

    return stitches.length > 0 ? stitches[0] : null;
  }
}

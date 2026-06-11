import { Injectable, Inject } from "@nestjs/common";
import { sql, eq, and } from "drizzle-orm";
import { integrationStitches, uiWorkspaceDataSources } from "@soopa/database";
import { StitchRepositoryPort, ActiveStitch } from "../../shared/ports/stitch.repository.port.js";
import { DB_MANAGER, type DatabaseManager } from "@soopa/dbmanager";

@Injectable()
export class DrizzleStitchRepositoryAdapter implements StitchRepositoryPort {
  constructor(
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  async findActiveStitches(
    tenantId: string,
    dataSourceId: string,
    canonicalType: string
  ): Promise<ActiveStitch[]> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);

    const stitches = await tenantDb
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
        sql`${integrationStitches.canonicalObject} = ${canonicalType} AND ${integrationStitches.status} = 'ACTIVE'`,
      );

    return stitches;
  }

  async findById(
    tenantId: string,
    stitchId: string
  ): Promise<ActiveStitch | null> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);

    const stitches = await tenantDb
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
      .where(eq(integrationStitches.id, stitchId))
      .limit(1);

    return stitches.length > 0 ? stitches[0] : null;
  }
}

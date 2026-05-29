import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
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
} from '@nexiom/database';
import type { CreateStitch, UpdateStitch } from './stitches.validation.js';
import {
  extractPgError,
  isUniqueViolation,
  PG_UNIQUE_VIOLATION,
} from '../../shared/db.utils.js';
import {
  DB_MANAGER,
  SchemaPlan,
  getWorkspaceSchemaName,
} from '@nexiom/dbmanager';
import type { DatabaseManager } from '@nexiom/dbmanager';

@Injectable()
export class StitchesService {
  private readonly logger = new Logger(StitchesService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  /**
   * Idempotently provisions both connection schemas to OUTBOUND_ACTIVE so the
   * full pipeline table stack (L1→L6) is ready before the first webhook fires.
   *
   * This method is invoked after the create transaction commits, so any errors
   * thrown from provisionStitchSchemas will propagate and abort the stitch
   * operation. However, because the stitch row has already been committed along
   * with queued registry outbox entries, a thrown error will leave both a
   * committed stitch and queued registry entries. Callers must handle
   * retry-on-resave or implement remediation logic for this state.
   *
   * Failures are logged and re-thrown to prevent pipeline execution against
   * un-provisioned schemas (which would cause immediate failures at L1/L2).
   */
  private async provisionStitchSchemas(
    orgId: string,
    destDataSourceId: string,
    destAppName: string,
  ): Promise<void> {
    const pairs = [{ dataSourceId: destDataSourceId, appName: destAppName }];
    await Promise.all(
      pairs.map(async ({ dataSourceId, appName }) => {
        const schemaName = getWorkspaceSchemaName(dataSourceId, appName);
        try {
          await this.dbManager.applyPlan(
            orgId,
            schemaName,
            SchemaPlan.OUTBOUND_ACTIVE,
          );
          this.logger.debug(
            `Provisioned schema ${schemaName} to OUTBOUND_ACTIVE`,
          );
        } catch (err) {
          this.logger.error(
            `Failed to provision schema ${schemaName}: ${err instanceof Error ? err.message : String(err)}`,
          );
          // Re-throw — a missing schema would cause immediate pipeline failures.
          throw err;
        }
      }),
    );
  }

  async create(orgId: string, body: CreateStitch) {
    // Verify workspace belongs to org
    const workspace = await this.db.query.uiWorkspaces.findFirst({
      where: and(
        eq(uiWorkspaces.id, body.workspaceId),
        eq(uiWorkspaces.orgId, orgId),
      ),
    });
    if (!workspace) {
      throw new NotFoundException(`Workspace ${body.workspaceId} not found.`);
    }

    // Verify destination connection belongs to org
    const destConn = await this.db
      .select()
      .from(dataSources)
      .where(
        and(
          eq(dataSources.id, body.destDataSourceId),
          eq(dataSources.tenantId, orgId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);

    if (!destConn) {
      throw new NotFoundException(
        `Data source ${body.destDataSourceId} not found.`,
      );
    }

    let stitch: typeof integrationStitches.$inferSelect;
    try {
      stitch = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(integrationStitches)
          .values({
            name: body.name,
            orgId,
            workspaceId: body.workspaceId,
            destDataSourceId: body.destDataSourceId,
            canonicalObject: body.canonicalObject,
            targetObject: body.targetObject,
            ...(body.syncCondition !== undefined && {
              syncCondition: body.syncCondition,
            }),
            ...(body.status !== undefined && { status: body.status }),
          })
          .returning();

        if (!row) {
          throw new InternalServerErrorException(
            'Insert did not return a row.',
          );
        }

        // Atomically persist any initial field mappings supplied by the wizard.
        // Doing this in the same transaction guarantees no orphaned stitch rows
        // when the mapping insert would otherwise fail after a successful stitch insert.
        if (body.fieldMappings && body.fieldMappings.length > 0) {
          const insertedFms = await tx
            .insert(fieldMappings)
            .values(
              body.fieldMappings.map((fm) => ({
                stitchId: row.id,
                sourceCanonical: fm.sourceCanonical,
                mappingRules: fm.mappingRules,
              })),
            )
            .returning();

          await tx.insert(globalRegistryOutbox).values(
            insertedFms.map((fm) => ({
              tenantId: orgId,
              entityType: 'FIELD_MAPPING' as const,
              entityId: fm.id,
              action: 'UPSERT' as const,
              payload: fm,
            })),
          );
        }

        await tx.insert(globalRegistryOutbox).values({
          tenantId: orgId,
          entityType: 'INTEGRATION_STITCH',
          entityId: row.id,
          action: 'UPSERT',
          payload: row,
        });

        return row;
      });
    } catch (err) {
      const pgErr = extractPgError(err);
      if (pgErr?.code === PG_UNIQUE_VIOLATION) {
        // Distinguish which unique index fired so the message is accurate.
        // Both inserts (integrationStitches and fieldMappings) run inside the
        // same transaction, so the outer catch must route by constraint name.
        if (pgErr.constraint === 'stitch_name_workspace_unique_idx') {
          throw new ConflictException(
            `A stitch named "${body.name}" already exists in this workspace.`,
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

    // ── Provision both connection schemas to OUTBOUND_ACTIVE ────────────────
    // Must happen AFTER the stitch row exists (not inside the TX) so that
    // the provisioner can reference the committed connection rows.
    // All DDL is idempotent — safe to re-run if the schemas already exist.
    await this.provisionStitchSchemas(orgId, destConn.id, destConn.appName);

    return stitch;
  }

  async list(orgId: string, workspaceId?: string, includeArchived = false) {
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

  async findOne(orgId: string, id: string) {
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

  /**
   * Mutable fields: name, status, syncCondition, syncIntervalMinutes, scheduleEnabled.
   * Immutable fields: sourceObject, targetObject, srcDataSourceId, destDataSourceId,
   * workspaceId — these define the stitch identity. To change them, archive this
   * stitch and create a new one.
   */
  async update(orgId: string, id: string, body: UpdateStitch) {
    const hasChanges =
      body.name !== undefined ||
      body.status !== undefined ||
      body.syncCondition !== undefined;

    if (!hasChanges) {
      throw new BadRequestException('No updatable fields provided.');
    }

    try {
      const updated = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(integrationStitches)
          .set({
            ...(body.name !== undefined && { name: body.name }),
            ...(body.status !== undefined && { status: body.status }),
            ...(body.syncCondition !== undefined && {
              syncCondition: body.syncCondition,
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

        await tx.insert(globalRegistryOutbox).values({
          tenantId: orgId,
          entityType: 'INTEGRATION_STITCH',
          entityId: row.id,
          action: 'UPSERT',
          payload: row,
        });

        return row;
      });

      return updated;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `A stitch named "${body.name}" already exists in this workspace.`,
        );
      }
      throw err;
    }
  }

  async remove(orgId: string, id: string) {
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

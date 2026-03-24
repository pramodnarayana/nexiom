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
  appConnections,
} from '@nexiom/database';
import type { CreateStitch, UpdateStitch } from './stitches.validation.js';
import {
  extractPgError,
  isUniqueViolation,
  PG_UNIQUE_VIOLATION,
} from '../../shared/db.utils.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';

@Injectable()
export class StitchesService {
  private readonly logger = new Logger(StitchesService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly scheduler: SchedulerService,
  ) {}

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

    if (body.srcConnectionId === body.destConnectionId) {
      throw new BadRequestException(
        'Source and destination connections must be different.',
      );
    }

    // Verify both connections belong to org — run in parallel to halve latency
    const [srcConn, destConn] = await Promise.all([
      this.db.query.appConnections.findFirst({
        where: and(
          eq(appConnections.id, body.srcConnectionId),
          eq(appConnections.tenantId, orgId),
        ),
      }),
      this.db.query.appConnections.findFirst({
        where: and(
          eq(appConnections.id, body.destConnectionId),
          eq(appConnections.tenantId, orgId),
        ),
      }),
    ]);
    if (!srcConn) {
      throw new NotFoundException(
        `Connection ${body.srcConnectionId} not found.`,
      );
    }
    if (!destConn) {
      throw new NotFoundException(
        `Connection ${body.destConnectionId} not found.`,
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
            srcConnectionId: body.srcConnectionId,
            destConnectionId: body.destConnectionId,
            sourceObject: body.sourceObject,
            targetObject: body.targetObject,
            ...(body.syncCondition !== undefined && {
              syncCondition: body.syncCondition,
            }),
            ...(body.status !== undefined && { status: body.status }),
            ...(body.syncIntervalMinutes !== undefined && {
              syncIntervalMinutes: body.syncIntervalMinutes,
            }),
            ...(body.scheduleEnabled !== undefined && {
              scheduleEnabled: body.scheduleEnabled,
            }),
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
          await tx.insert(fieldMappings).values(
            body.fieldMappings.map((fm) => ({
              stitchId: row.id,
              sourceCanonical: fm.sourceCanonical,
              mappingRules: fm.mappingRules,
            })),
          );
        }

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

    // Transaction has committed — safe to notify Windmill now.
    // Fire-and-forget: schedule sync must not block or fail the create response.
    this.scheduler.onStitchCreated(stitch).catch((err: unknown) => {
      this.logger.error(
        `Failed to create Windmill schedule for stitch ${stitch.id}: ${String(err)}`,
      );
    });

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
    });
    if (!stitch) {
      throw new NotFoundException(`Stitch ${id} not found.`);
    }
    return stitch;
  }

  /**
   * Mutable fields: name, status, syncCondition, syncIntervalMinutes, scheduleEnabled.
   * Immutable fields: sourceObject, targetObject, srcConnectionId, destConnectionId,
   * workspaceId — these define the stitch identity. To change them, archive this
   * stitch and create a new one.
   */
  async update(orgId: string, id: string, body: UpdateStitch) {
    const hasChanges =
      body.name !== undefined ||
      body.status !== undefined ||
      body.syncCondition !== undefined ||
      body.syncIntervalMinutes !== undefined ||
      body.scheduleEnabled !== undefined;

    if (!hasChanges) {
      throw new BadRequestException('No updatable fields provided.');
    }

    try {
      const [updated] = await this.db
        .update(integrationStitches)
        .set({
          ...(body.name !== undefined && { name: body.name }),
          ...(body.status !== undefined && { status: body.status }),
          ...(body.syncCondition !== undefined && {
            syncCondition: body.syncCondition,
          }),
          ...(body.syncIntervalMinutes !== undefined && {
            syncIntervalMinutes: body.syncIntervalMinutes,
          }),
          ...(body.scheduleEnabled !== undefined && {
            scheduleEnabled: body.scheduleEnabled,
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

      if (!updated) {
        throw new NotFoundException(`Stitch ${id} not found.`);
      }

      const scheduleFieldsChanged =
        body.syncIntervalMinutes !== undefined ||
        body.scheduleEnabled !== undefined;
      if (scheduleFieldsChanged) {
        this.scheduler.onStitchUpdated(updated).catch((err: unknown) => {
          this.logger.error(
            `Failed to sync Windmill schedule for stitch ${updated.id}: ${String(err)}`,
          );
        });
      }

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

  async updateSchedule(
    orgId: string,
    id: string,
    body: { syncIntervalMinutes?: number; scheduleEnabled?: boolean },
  ) {
    const [updated] = await this.db
      .update(integrationStitches)
      .set(this.buildScheduleSet(body))
      .where(
        and(
          eq(integrationStitches.id, id),
          eq(integrationStitches.orgId, orgId),
        ),
      )
      .returning();

    if (!updated) throw new NotFoundException(`Stitch ${id} not found.`);

    this.scheduler.onStitchUpdated(updated).catch((err: unknown) => {
      this.logger.error(
        `Failed to sync Windmill schedule for stitch ${updated.id}: ${String(err)}`,
      );
    });

    return updated;
  }

  async updateScheduleAdmin(
    id: string,
    body: { syncIntervalMinutes?: number; scheduleEnabled?: boolean },
  ) {
    // No org scoping — admin/support use only. Caller must be a SystemAdmin.
    const [updated] = await this.db
      .update(integrationStitches)
      .set(this.buildScheduleSet(body))
      .where(eq(integrationStitches.id, id))
      .returning();

    if (!updated) throw new NotFoundException(`Stitch ${id} not found.`);

    this.scheduler.onStitchUpdated(updated).catch((err: unknown) => {
      this.logger.error(
        `Failed to sync Windmill schedule for stitch ${updated.id}: ${String(err)}`,
      );
    });

    return updated;
  }

  /**
   * Builds the Drizzle `.set()` payload for schedule updates.
   * Throws BadRequestException when neither field is provided.
   */
  private buildScheduleSet(body: {
    syncIntervalMinutes?: number;
    scheduleEnabled?: boolean;
  }) {
    if (
      body.syncIntervalMinutes === undefined &&
      body.scheduleEnabled === undefined
    ) {
      throw new BadRequestException('No schedule fields provided.');
    }
    return {
      ...(body.syncIntervalMinutes !== undefined && {
        syncIntervalMinutes: body.syncIntervalMinutes,
      }),
      ...(body.scheduleEnabled !== undefined && {
        scheduleEnabled: body.scheduleEnabled,
      }),
      updatedAt: new Date(),
    };
  }

  async listAdmin() {
    // Explicit column allowlist guards against future sensitive columns being
    // inadvertently returned by a wildcard select after schema additions.
    return this.db.query.integrationStitches.findMany({
      columns: {
        id: true,
        orgId: true,
        workspaceId: true,
        name: true,
        srcConnectionId: true,
        destConnectionId: true,
        sourceObject: true,
        targetObject: true,
        syncCondition: true,
        status: true,
        syncIntervalMinutes: true,
        scheduleEnabled: true,
        lastScheduledAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [
        asc(integrationStitches.orgId),
        asc(integrationStitches.createdAt),
      ],
    });
  }

  async bulkUpdateScheduleByOrg(
    orgId: string,
    body: { syncIntervalMinutes?: number; scheduleEnabled?: boolean },
  ) {
    const updated = await this.db
      .update(integrationStitches)
      .set(this.buildScheduleSet(body))
      .where(
        and(
          eq(integrationStitches.orgId, orgId),
          ne(integrationStitches.status, 'ARCHIVED'),
        ),
      )
      .returning();

    const count = updated.length;
    if (count === 0) {
      this.logger.warn(
        `bulkUpdateScheduleByOrg: no non-archived stitches found for org ${orgId}`,
      );
    }

    // Sync all updated schedules in parallel; individual failures are logged but do not abort.
    const scheduleResults = await Promise.allSettled(
      updated.map((stitch) => this.scheduler.onStitchUpdated(stitch)),
    );
    scheduleResults.forEach((result, i) => {
      if (result.status === 'rejected') {
        this.logger.error(
          `Failed to sync Windmill schedule for stitch ${updated[i].id}: ${String(result.reason)}`,
        );
      }
    });

    return { updated, count };
  }

  async remove(orgId: string, id: string) {
    const [archived] = await this.db
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

    this.scheduler.onStitchDeleted(id).catch((err: unknown) => {
      this.logger.error(
        `Failed to delete Windmill schedule for stitch ${id}: ${String(err)}`,
      );
    });
  }
}

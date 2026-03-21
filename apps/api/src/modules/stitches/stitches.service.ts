import {
  Injectable,
  Inject,
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
  uiWorkspaces,
  appConnections,
} from '@nexiom/database';
import type { CreateStitch, UpdateStitch } from './stitches.validation.js';

/** Postgres unique-constraint violation error code. */
const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === PG_UNIQUE_VIOLATION
  );
}

@Injectable()
export class StitchesService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

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

    try {
      const [stitch] = await this.db
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

      if (!stitch) {
        throw new InternalServerErrorException('Insert did not return a row.');
      }
      return stitch;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `A stitch named "${body.name}" already exists in this workspace.`,
        );
      }
      throw err;
    }
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
    return updated;
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
  }
}

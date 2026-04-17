import {
  Controller,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import {
  AuthGuard,
  PermissionsGuard,
  RequirePermission,
  AuthContext,
  type RequestAuthContext,
} from '@nexiom/auth';
import { and, eq } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  fieldMappings,
  integrationStitches,
} from '@nexiom/database';
import { UpsertFieldMappingBody } from './field-mappings.validation.js';
import { requireOrgId } from '../workspaces/workspace.utils.js';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('stitches/:stitchId/mappings')
export class FieldMappingsController {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  /** Upsert a field-mapping template for a given canonical type on a stitch. */
  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('stitches', 'manage')
  upsert(
    @AuthContext() auth: RequestAuthContext,
    @Param('stitchId', ParseUUIDPipe) stitchId: string,
    @Body() body: UpsertFieldMappingBody,
  ) {
    return this.performUpsert(requireOrgId(auth), stitchId, body);
  }

  /** Alias for POST — PATCH upserts the same way for idempotent client calls. */
  @Patch()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('stitches', 'manage')
  update(
    @AuthContext() auth: RequestAuthContext,
    @Param('stitchId', ParseUUIDPipe) stitchId: string,
    @Body() body: UpsertFieldMappingBody,
  ) {
    return this.performUpsert(requireOrgId(auth), stitchId, body);
  }

  private async performUpsert(
    orgId: string,
    stitchId: string,
    body: UpsertFieldMappingBody,
  ) {
    // Verify stitch belongs to org
    const stitch = await this.db.query.integrationStitches.findFirst({
      where: and(
        eq(integrationStitches.id, stitchId),
        eq(integrationStitches.orgId, orgId),
      ),
    });
    if (!stitch) throw new NotFoundException(`Stitch ${stitchId} not found.`);

    const [result] = await this.db
      .insert(fieldMappings)
      .values({
        stitchId,
        sourceCanonical: body.sourceCanonical,
        mappingRules: body.mappingRules,
      })
      .onConflictDoUpdate({
        target: [fieldMappings.stitchId, fieldMappings.sourceCanonical],
        set: {
          mappingRules: body.mappingRules,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result;
  }

  /**
   * DELETE /stitches/:stitchId/mappings/:sourceCanonical
   *
   * Permanently removes all mapping rules for the given canonical on this
   * stitch. Called when the user removes a source-object tab or clears all
   * rules and saves. Returns 204 No Content on success.
   */
  @Delete(':sourceCanonical')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('stitches', 'manage')
  async remove(
    @AuthContext() auth: RequestAuthContext,
    @Param('stitchId', ParseUUIDPipe) stitchId: string,
    @Param('sourceCanonical') sourceCanonical: string,
  ) {
    await this.performDelete(requireOrgId(auth), stitchId, sourceCanonical);
  }

  private async performDelete(
    orgId: string,
    stitchId: string,
    sourceCanonical: string,
  ) {
    // Ownership check — never trust the caller's stitchId alone.
    const stitch = await this.db.query.integrationStitches.findFirst({
      where: and(
        eq(integrationStitches.id, stitchId),
        eq(integrationStitches.orgId, orgId),
      ),
    });
    if (!stitch) throw new NotFoundException(`Stitch ${stitchId} not found.`);

    const deleted = await this.db
      .delete(fieldMappings)
      .where(
        and(
          eq(fieldMappings.stitchId, stitchId),
          eq(fieldMappings.sourceCanonical, sourceCanonical),
        ),
      )
      .returning({ id: fieldMappings.id });

    // Idempotent: return 204 regardless of whether rows were deleted.
    // deleted.length === 0 is a no-op, not an error.
  }
}
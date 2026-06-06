import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import {
  BaseRepository,
  RepositoryContext,
  integrationStitches,
  fieldMappings,
  DATABASE_CONNECTION,
  SAVEPOINT_MANAGER,
} from '@soopa/database';
import type { DrizzleDb, ISavePointManager } from '@soopa/database';
import { and, eq } from 'drizzle-orm';
import type {
  UpsertFieldMappingBody,
  BulkUpsertAndDeleteBody,
} from '../field-mappings.validation.js';

@Injectable()
export class FieldMappingsRepository extends BaseRepository<
  typeof integrationStitches
> {
  constructor(
    @Inject(DATABASE_CONNECTION) db: DrizzleDb,
    @Inject(SAVEPOINT_MANAGER) savepointManager: ISavePointManager,
  ) {
    super(db, savepointManager, integrationStitches);
  }

  /** Verify stitch ownership. Returns null when stitch does not belong to org. */
  async findStitchForOrg(
    stitchId: string,
    orgId: string,
    ctx?: RepositoryContext,
  ) {
    const exec = this.getExecutor(ctx);
    const result = await exec.query.integrationStitches.findFirst({
      where: and(
        eq(integrationStitches.id, stitchId),
        eq(integrationStitches.orgId, orgId),
      ),
    });
    return result ?? null;
  }

  /** Upsert a single field mapping. Throws NotFoundException if stitch not in org. */
  async upsertMapping(
    orgId: string,
    stitchId: string,
    body: UpsertFieldMappingBody,
    ctx?: RepositoryContext,
  ) {
    const stitch = await this.findStitchForOrg(stitchId, orgId, ctx);
    if (!stitch) throw new NotFoundException(`Stitch ${stitchId} not found.`);

    const exec = this.getExecutor(ctx);
    const [result] = await exec
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

  /** Delete field mappings for a sourceCanonical. Idempotent — no error if absent. */
  async deleteMapping(
    orgId: string,
    stitchId: string,
    sourceCanonical: string,
    ctx?: RepositoryContext,
  ) {
    const stitch = await this.findStitchForOrg(stitchId, orgId, ctx);
    if (!stitch) throw new NotFoundException(`Stitch ${stitchId} not found.`);

    const exec = this.getExecutor(ctx);
    await exec
      .delete(fieldMappings)
      .where(
        and(
          eq(fieldMappings.stitchId, stitchId),
          eq(fieldMappings.sourceCanonical, sourceCanonical),
        ),
      );
  }

  /**
   * Atomically delete and upsert mappings in a single transaction.
   * Throws NotFoundException if stitch does not belong to org.
   */
  async bulkUpsertAndDelete(
    orgId: string,
    stitchId: string,
    body: BulkUpsertAndDeleteBody,
    ctx?: RepositoryContext,
  ) {
    const stitch = await this.findStitchForOrg(stitchId, orgId, ctx);
    if (!stitch) throw new NotFoundException(`Stitch ${stitchId} not found.`);

    return this.transaction(async (txCtx) => {
      // Delete orphaned canonicals
      for (const canonical of body.toDelete) {
        const exec = this.getExecutor(txCtx);
        await exec
          .delete(fieldMappings)
          .where(
            and(
              eq(fieldMappings.stitchId, stitchId),
              eq(fieldMappings.sourceCanonical, canonical),
            ),
          );
      }

      // Upsert all mappings
      const results = [];
      for (const mapping of body.toUpsert) {
        const exec = this.getExecutor(txCtx);
        const [result] = await exec
          .insert(fieldMappings)
          .values({
            stitchId,
            sourceCanonical: mapping.sourceCanonical,
            mappingRules: mapping.mappingRules,
          })
          .onConflictDoUpdate({
            target: [fieldMappings.stitchId, fieldMappings.sourceCanonical],
            set: {
              mappingRules: mapping.mappingRules,
              updatedAt: new Date(),
            },
          })
          .returning();
        results.push(result);
      }

      return results;
    }, ctx);
  }
}

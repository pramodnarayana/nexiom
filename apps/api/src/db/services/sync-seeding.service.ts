import { Injectable } from '@nestjs/common';
import { EnvironmentGuardService } from './environment-guard.service.js';
import { PgConnectionPool } from '../infrastructure/pg-connection.pool.js';

@Injectable()
export class SyncSeedingService {
  constructor(
    private readonly environmentGuard: EnvironmentGuardService,
    private readonly connectionPool: PgConnectionPool,
  ) {}

  /**
   * Seeds field mappings generically based on the provided data
   */
  async seedMappings(
    mappings: import('../data/seed-mappings.js').SeedMapping[],
  ): Promise<void> {
    this.environmentGuard.assertSafeEnvironment();
    console.log(`🌱 Seeding ${mappings.length} local field mapping(s)...`);

    await this.connectionPool.withDrizzle(async (db, schema) => {
      const { eq, and } = await import('drizzle-orm');

      // Deterministically resolve the target workspace
      // Option 1: Use environment variable if provided
      const envWorkspaceId = process.env.SEED_WORKSPACE_ID;
      let workspaceId: string;
      let orgId: string;

      if (envWorkspaceId) {
        const workspaces = await db
          .select()
          .from(schema.uiWorkspaces)
          .where(eq(schema.uiWorkspaces.id, envWorkspaceId))
          .limit(1);
        if (workspaces.length === 0) {
          throw new Error(
            `Workspace with ID "${envWorkspaceId}" (from SEED_WORKSPACE_ID) not found.`,
          );
        }
        workspaceId = workspaces[0].id;
        orgId = workspaces[0].orgId;
      } else {
        // Option 2: Query for a canonical/default workspace
        const workspaces = await db.select().from(schema.uiWorkspaces).limit(2);

        if (workspaces.length === 0) {
          throw new Error(
            'No workspace found. Run pnpm db:seed first or set SEED_WORKSPACE_ID.',
          );
        }
        if (workspaces.length > 1) {
          throw new Error(
            'Multiple workspaces found. Please set SEED_WORKSPACE_ID environment variable to specify which workspace to use for seeding.',
          );
        }
        workspaceId = workspaces[0].id;
        orgId = workspaces[0].orgId;
      }

      for (const mapping of mappings) {
        // Look up the deterministic fixtures to ensure they exist
        const sourceConn = await db
          .select()
          .from(schema.dataSources)
          .where(eq(schema.dataSources.id, mapping.sourceDataSourceId))
          .limit(1);

        const destConn = await db
          .select()
          .from(schema.dataSources)
          .where(eq(schema.dataSources.id, mapping.destDataSourceId))
          .limit(1);

        if (!sourceConn[0] || !destConn[0]) {
          console.warn(
            `  ⚠️  Skipping mapping "${mapping.name}": required connections not found.`,
          );
          continue;
        }

        // Check for existing stitch
        const stitches = await db
          .select()
          .from(schema.integrationStitches)
          .where(
            and(
              eq(
                schema.integrationStitches.canonicalObject,
                mapping.canonicalObject,
              ),
              eq(
                schema.integrationStitches.destDataSourceId,
                mapping.destDataSourceId,
              ),
              eq(schema.integrationStitches.workspaceId, workspaceId),
            ),
          )
          .limit(1);

        let stitchId;
        if (stitches.length === 0) {
          const [newStitch] = await db
            .insert(schema.integrationStitches)
            .values({
              name: mapping.name,
              orgId: orgId,
              workspaceId: workspaceId,
              destDataSourceId: mapping.destDataSourceId,
              canonicalObject: mapping.canonicalObject,
              targetObject: mapping.targetObject,
            })
            .returning();
          stitchId = newStitch.id;
          console.log(
            `  ✓ Created new integration stitch: ${stitchId} for ${mapping.name}`,
          );
        } else {
          stitchId = stitches[0].id;
          console.log(
            `  ✓ Found existing integration stitch: ${stitchId} for ${mapping.name}`,
          );
        }

        // Insert or Update the field mapping rules
        await db
          .insert(schema.fieldMappings)
          .values({
            stitchId: stitchId,
            sourceCanonical: mapping.canonicalObject,
            mappingRules: mapping.mappingRules,
          })
          .onConflictDoUpdate({
            target: [
              schema.fieldMappings.stitchId,
              schema.fieldMappings.sourceCanonical,
            ],
            set: {
              mappingRules: mapping.mappingRules,
            },
          });

        console.log(
          `  ✓ Inserted field mapping rules for ${mapping.canonicalObject}`,
        );
      }

      console.log('✅ Local Pipeline Mappings Seeded.');
    });
  }
}

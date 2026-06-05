import { Injectable } from '@nestjs/common';
import { PgConnectionPool } from '../infrastructure/pg-connection.pool.js';
import { EnvironmentGuardService } from './environment-guard.service.js';
import { fileURLToPath } from 'node:url';

@Injectable()
export class SystemSeederService {
  constructor(
    private readonly connectionPool: PgConnectionPool,
    private readonly environmentGuard: EnvironmentGuardService,
  ) {}

  async seed(): Promise<void> {
    this.environmentGuard.assertSafeEnvironment();
    console.log('🌱 Seeding database...');

    const { drizzle } = await import('drizzle-orm/node-postgres');
    const schema = await import('@soopa/database');
    const { eq, sql, notInArray } = await import('drizzle-orm');
    const { seedSystemRbac, DrizzleRbacRepository } =
      await import('@soopa/identity/utils/rbac-seeding');
    const {
      getRequiredOwnerRoleId,
      getRequiredAdminRoleId,
      getRequiredMemberRoleId,
      getRequiredSystemTenantId,
    } = await import('../../constants.js');

    const client = await this.connectionPool.getPgClient();

    try {
      const db = drizzle(client, { schema });
      const systemTenantId = getRequiredSystemTenantId();

      // 1. Ensure system organization exists
      const existingOrg = await db.query.organization.findFirst({
        where: eq(schema.organization.id, systemTenantId),
      });

      if (!existingOrg) {
        await db.insert(schema.organization).values({
          id: systemTenantId,
          name: 'Nexiom Platform',
          slug: 'system',
          isSystem: true,
        });
        console.log('  ✓ System organization created');
      }

      // 2. Seed RBAC data
      const config = {
        ownerRoleId: getRequiredOwnerRoleId(),
        adminRoleId: getRequiredAdminRoleId(),
        memberRoleId: getRequiredMemberRoleId(),
        systemTenantId,
      };

      // Create a separate DB instance with identity schema for seedSystemRbac
      const identitySchema = await import('@soopa/identity/schema');
      const identityDb = drizzle(client, { schema: identitySchema });
      const rbacRepo = new DrizzleRbacRepository(identityDb);
      await seedSystemRbac(rbacRepo, config, console);

      // 3. Seed Marketplace Pieces dynamically from monorepo (Enterprise-Grade)
      const { v4: uuidv4Marketplace } = await import('uuid');
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      console.log('  🧩 Auto-discovering marketplace pieces...');

      // Resolve the pieces directory from the current file's location so the
      // path is correct regardless of working directory (CI, Docker, local).
      // __dirname equivalent for ESM: fileURLToPath(import.meta.url) gives us
      // <monorepo>/apps/api/src/db/services/system-seeder.service.{ts|js}
      // → resolve 5 levels up to reach the monorepo root.
      const thisFile = fileURLToPath(import.meta.url);
      const monorepoRoot = path.resolve(
        path.dirname(thisFile),
        '../../../../../',
      );
      const piecePaths = [
        path.join(monorepoRoot, 'packages/pieces/application'),
        path.join(monorepoRoot, 'packages/pieces/platform'),
      ];

      const allPieceFolders: string[] = [];
      let discoverySuccess = true;

      for (const pDir of piecePaths) {
        try {
          const folders = await fs.readdir(pDir);
          allPieceFolders.push(...folders.map((f) => path.join(pDir, f)));
        } catch (readdirErr) {
          console.warn(
            `  ⚠️  Could not read pieces directory "${pDir}": ${readdirErr instanceof Error ? readdirErr.message : String(readdirErr)}. `,
          );
          discoverySuccess = false;
        }
      }

      const discoveredPieces = [];

      for (const piecePath of allPieceFolders) {
        const stat = await fs.stat(piecePath).catch((err: unknown) => {
          console.warn(
            `    ⚠️ Could not stat piece path "${piecePath}": ${err instanceof Error ? err.message : String(err)}. Marking discovery as failed.`,
          );
          discoverySuccess = false;
          return null;
        });

        if (stat?.isDirectory()) {
          try {
            // Read package.json to get the canonical npm package name
            const pkgPath = path.join(piecePath, 'package.json');
            const pkgRaw = await fs.readFile(pkgPath, 'utf-8');
            const pkg = JSON.parse(pkgRaw) as { name: string; version: string };

            // Dynamically import the installed module just like Nexiom Engine does
            const mod = (await import(pkg.name)) as Record<string, unknown>;
            let pieceDef: Record<string, unknown> | null = null;

            for (const exported of Object.values(mod)) {
              if (
                exported &&
                typeof exported === 'object' &&
                'name' in exported &&
                'displayName' in exported &&
                'logoUrl' in exported
              ) {
                pieceDef = exported as Record<string, unknown>;
                break;
              }
            }

            if (pieceDef) {
              discoveredPieces.push({
                id: uuidv4Marketplace(),
                name: String(pieceDef.name),
                displayName: String(pieceDef.displayName),
                packageName: pkg.name,
                version: pkg.version || 'workspace',
                // eslint-disable-next-line @typescript-eslint/no-base-to-string
                logoUrl: String(pieceDef.logoUrl || ''),
                enabled: true,
              });
              console.log(
                `    ✅ Discovered piece: ${String(pieceDef.displayName)} (${pkg.name})`,
              );
            }
          } catch (e) {
            console.warn(
              `    ⚠️ Failed to load piece from folder ${piecePath}: ${e instanceof Error ? e.message : String(e)}. Marking discovery as failed.`,
            );
            discoverySuccess = false;
          }
        }
      }

      if (discoveredPieces.length > 0) {
        await db
          .insert(schema.pieces)
          .values(discoveredPieces)
          .onConflictDoUpdate({
            target: schema.pieces.name,
            set: {
              displayName: sql`EXCLUDED.display_name`,
              logoUrl: sql`EXCLUDED.logo_url`,
              packageName: sql`EXCLUDED.package_name`,
              version: sql`EXCLUDED.version`,
              updatedAt: new Date(),
            },
          });
        console.log(
          `  ✓ Upserted ${discoveredPieces.length} pieces into registry`,
        );

        if (discoverySuccess) {
          const discoveredPackageNames = discoveredPieces.map(
            (p) => p.packageName,
          );
          await db
            .update(schema.pieces)
            .set({ enabled: false })
            .where(
              notInArray(schema.pieces.packageName, discoveredPackageNames),
            );
          console.log('  ✓ Cleaned up removed pieces from registry');
        }
      } else {
        if (discoverySuccess && process.env.ALLOW_DISABLE_ALL === 'true') {
          console.warn(
            `  ⚠️  ALLOW_DISABLE_ALL is set. discoverySuccess=${String(discoverySuccess)}, discoveredPieces.length=${String(discoveredPieces.length)}. Disabling ALL pieces in registry.`,
          );
          await db.update(schema.pieces).set({ enabled: false });
          console.log('  ✓ Disabled all pieces (none discovered)');
        } else if (discoverySuccess) {
          console.warn(
            `  ⚠️  No pieces discovered but ALLOW_DISABLE_ALL is not set — skipping mass disable to avoid accidental data loss.`,
          );
        }
        console.log('  ℹ️ No pieces discovered.');
      }

      // 4. Seed Bootstrap Owner (User Request)
      const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
      const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
      const name = process.env.BOOTSTRAP_ADMIN_NAME;

      if (email && password && name) {
        const maskedEmail = email.replace(/(.{2}).*(@.*)/, '$1***$2');
        console.log(`  👤 Seeding bootstrap owner: ${maskedEmail}`);
        const bcrypt = await import('bcryptjs');
        const { v4: uuidv4 } = await import('uuid');

        // Check if user exists
        let user = await db.query.user.findFirst({
          where: eq(schema.user.email, email),
        });

        // Stable ID for transaction compatibility
        const userId = user?.id || uuidv4();
        const now = new Date();

        if (user) {
          console.log('    ℹ️  User already exists');

          // Upsert bootstrap credential for existing user
          const hashedPassword = await bcrypt.hash(password, 10);
          await db
            .insert(schema.account)
            .values({
              id: uuidv4(),
              userId: userId,
              accountId: email,
              providerId: 'credential',
              password: hashedPassword,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [schema.account.userId, schema.account.providerId],
              set: {
                password: hashedPassword,
                updatedAt: now,
              },
            });
          console.log('    ✓ Bootstrap credential upserted');

          // Ensure System Membership (Owner) for existing user
          const existingMember = await db.query.member.findFirst({
            where: (m, { and, eq }) =>
              and(eq(m.userId, userId), eq(m.organizationId, systemTenantId)),
          });

          if (!existingMember) {
            await db
              .insert(schema.member)
              .values({
                id: uuidv4(),
                userId: userId,
                organizationId: systemTenantId,
                role: config.ownerRoleId,
                createdAt: now,
              })
              .onConflictDoNothing();
            console.log('    ✓ System Owner membership created');
          } else if (existingMember.role !== config.ownerRoleId) {
            // Promote existing member to owner if not already owner
            await db
              .update(schema.member)
              .set({
                role: config.ownerRoleId,
                updatedAt: now,
              })
              .where(eq(schema.member.id, existingMember.id));
            console.log('    ✓ Promoted existing member to System Owner');
          }
        } else {
          const hashedPassword = await bcrypt.hash(password, 10);

          await db.transaction(async (tx) => {
            // Create User
            await tx.insert(schema.user).values({
              id: userId,
              email,
              name,
              emailVerified: true,
              createdAt: now,
              updatedAt: now,
              role: 'member', // Legacy fallback
            });

            // Create Account (Credential)
            await tx.insert(schema.account).values({
              id: uuidv4(),
              userId: userId,
              accountId: email,
              providerId: 'credential',
              password: hashedPassword,
              createdAt: now,
              updatedAt: now,
            });

            // Ensure System Membership (Owner) - Atomic with User Creation
            await tx.insert(schema.member).values({
              id: uuidv4(),
              userId: userId,
              organizationId: systemTenantId,
              role: config.ownerRoleId,
              createdAt: now,
            });
            console.log('    ✓ System Owner membership created');

            user = { id: userId } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
          });
          console.log('    ✓ User and Account created');
        }
      } else {
        console.log('  ⚠️  Skipping bootstrap user: Missing env vars');
      }

      console.log('  ✓ Seeding complete');
    } finally {
      await client.end();
    }
  }

  /**
   * Seed ABAC data for manual verification
   * Creates restricted_admin role with conditional permissions
   */
  async seedAbac(
    permissions: import('../data/seed-abac.js').SeedPermission[],
  ): Promise<void> {
    this.environmentGuard.assertSafeEnvironment();
    console.log('🌱 Seeding ABAC data for verification...');

    const { getRequiredOwnerRoleId } = await import('../../constants.js');
    const ownerRoleId = getRequiredOwnerRoleId();

    await this.connectionPool.withDrizzle(async (db, schema) => {
      // 1. Ensure permissions exist
      if (permissions.length > 0) {
        await db
          .insert(schema.permission)
          .values(permissions)
          .onConflictDoNothing();
        console.log(
          `  ✓ Permissions ${permissions.map((p) => `"${p.id}"`).join(', ')} ensured`,
        );
      }

      // 2. Create "restricted_admin" role
      await db
        .insert(schema.role)
        .values({
          id: 'restricted_admin',
          name: 'Restricted Admin',
          description: 'Can manage users but cannot delete Owners',
          isSystem: false,
        })
        .onConflictDoNothing();
      console.log('  ✓ Role "restricted_admin" created');

      // 3. Grant "users:read" (Global access)
      await db
        .insert(schema.rolePermission)
        .values({
          id: 'rp_restricted_read',
          roleId: 'restricted_admin',
          permissionId: 'users:read',
        })
        .onConflictDoNothing();
      console.log('  ✓ Granted "users:read"');

      // 4. Grant "users:delete" WITH ABAC CONDITION
      await db
        .insert(schema.rolePermission)
        .values({
          id: 'rp_restricted_delete',
          roleId: 'restricted_admin',
          permissionId: 'users:delete',
          conditions: {
            role: { $ne: ownerRoleId },
          } as import('@soopa/database').AbacConditions,
        })
        .onConflictDoNothing();
      console.log(
        `  ✓ Granted "users:delete" with condition { role: { $ne: "${ownerRoleId}" } }`,
      );
    });
  }
  /**
   * Seeds the local dev mapping for TMS_CARRIER -> QuickBooks Vendor
   */
  async seedMapping(): Promise<void> {
    this.environmentGuard.assertSafeEnvironment();
    console.log(
      '🌱 Seeding local field mapping (TMS_CARRIER -> QuickBooks Vendor)...',
    );

    await this.connectionPool.withDrizzle(async (db) => {
      const { eq, and } = await import('drizzle-orm');
      const schema = await import('@soopa/database');

      // Look up the deterministic fixtures created by provisionLocal()
      const salesforceConn = await db
        .select()
        .from(schema.dataSources)
        .where(
          eq(schema.dataSources.id, '00000000-0000-0000-0000-000000000001'),
        )
        .limit(1);
      const qbConn = await db
        .select()
        .from(schema.dataSources)
        .where(
          eq(schema.dataSources.id, '00000000-0000-0000-0000-000000000002'),
        )
        .limit(1);

      if (!salesforceConn[0] || !qbConn[0]) {
        throw new Error(
          'No local connections found. Run pnpm db:provision:local first.',
        );
      }

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
        const workspaces = await db
          .select()
          .from(schema.uiWorkspaces)
          .limit(2);

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

      // Check for existing stitch
      const stitches = await db
        .select()
        .from(schema.integrationStitches)
        .where(
          and(
            eq(schema.integrationStitches.canonicalObject, 'TMS_CARRIER'),
            eq(schema.integrationStitches.destDataSourceId, qbConn[0].id),
            eq(schema.integrationStitches.workspaceId, workspaceId),
          ),
        )
        .limit(1);

      let stitchId;
      if (stitches.length === 0) {
        const [newStitch] = await db
          .insert(schema.integrationStitches)
          .values({
            name: 'Revenova to QuickBooks Local Sync',
            orgId: orgId,
            workspaceId: workspaceId,
            destDataSourceId: qbConn[0].id,
            canonicalObject: 'TMS_CARRIER',
            targetObject: 'Vendor',
          })
          .returning();
        stitchId = newStitch.id;
        console.log(`  ✓ Created new integration stitch: ${stitchId}`);
      } else {
        stitchId = stitches[0].id;
        console.log(`  ✓ Found existing integration stitch: ${stitchId}`);
      }

      // Extract mapping rules into a constant to avoid duplication
      const carrierMappingRules = [
        { srcPath: 'displayName', destPath: 'DisplayName' },
        { srcPath: 'displayName', destPath: 'CompanyName' },
        { srcPath: 'tp.mcNumber', destPath: 'GivenName' },
        { srcPath: 'remitTo.billingStreet', destPath: 'BillAddr.Line1' },
        { srcPath: 'remitTo.billingCity', destPath: 'BillAddr.City' },
        {
          srcPath: 'remitTo.billingState',
          destPath: 'BillAddr.CountrySubDivisionCode',
        },
        {
          srcPath: 'remitTo.billingPostalCode',
          destPath: 'BillAddr.PostalCode',
        },
        { srcPath: 'remitTo.billingCountry', destPath: 'BillAddr.Country' },
        { srcPath: 'billingStreet', destPath: 'ShipAddr.Line1' },
        { srcPath: 'billingCity', destPath: 'ShipAddr.City' },
        {
          srcPath: 'billingState',
          destPath: 'ShipAddr.CountrySubDivisionCode',
        },
        { srcPath: 'billingPostalCode', destPath: 'ShipAddr.PostalCode' },
        { srcPath: 'billingCountry', destPath: 'ShipAddr.Country' },
        { srcPath: 'phone', destPath: 'PrimaryPhone.FreeFormNumber' },
        { srcPath: 'fax', destPath: 'Fax.FreeFormNumber' },
      ];

      // Insert or Update the field mapping rule
      await db
        .insert(schema.fieldMappings)
        .values({
          stitchId: stitchId,
          sourceCanonical: 'TMS_CARRIER',
          mappingRules: carrierMappingRules,
        })
        .onConflictDoUpdate({
          target: [
            schema.fieldMappings.stitchId,
            schema.fieldMappings.sourceCanonical,
          ],
          set: {
            mappingRules: carrierMappingRules,
          },
        });

      console.log(
        '  ✓ Inserted dynamic JSON field mapping into field_mapping table!',
      );
      console.log('✅ Local Pipeline Mapping Seeded.');
    });
  }
}

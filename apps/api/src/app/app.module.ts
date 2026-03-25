import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { UsersModule } from '../modules/identity/users/users.module.js';
import { TenantsModule } from '../modules/identity/tenants/tenants.module.js';
import { AuthModule } from '@nexiom/auth';
import { IdentityAuthModule } from '../modules/identity/auth/auth.module.js';
import { DbModule } from '../db/db.module.js';
import { InvitationsModule } from '../modules/identity/invitations/invitations.module.js';
import { SystemAdminModule } from '../modules/identity/system-admin/system-admin.module.js';
import { RolesModule } from '../modules/identity/roles/roles.module.js';
import { IdentityModule } from '@nexiom/identity';
import { EmailService } from '../modules/email/email.service.abstract.js';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema.js';
import { ConnectionsModule } from '../modules/connections/connections.module.js';
import { TriggerModule } from '../modules/trigger/trigger.module.js';
import { EmailModule } from '../modules/email/email.module.js';
import { StorageResolverModule } from '../modules/storage-resolver/storage-resolver.module.js';
import { CacheModule } from '@nexiom/cache';
import { DbManagerModule } from '../modules/dbmanager/dbmanager.module.js';
import { WorkspacesModule } from '../modules/workspaces/workspaces.module.js';
import { StitchesModule } from '../modules/stitches/stitches.module.js';
import { SchedulerModule } from '../modules/scheduler/scheduler.module.js';
import { WebhooksModule } from '../modules/webhooks/webhooks.module.js';
import { ShutdownService } from '../core/shutdown.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        'apps/api/.env', // api-specific overrides (from monorepo root)
        '.env', // shared root env (from monorepo root)
      ],
    }),
    // Global Redis client — available to all modules via REDIS_CLIENT token
    CacheModule,
    // Global cron scheduler — required for PollerService and DlqProcessorService
    ScheduleModule.forRoot(),
    IdentityModule.registerAsync({
      imports: [
        ConfigModule,
        DbModule,
        forwardRef(() => AuthModule),
        EmailModule,
      ], // Ensure DbModule and EmailModule are here
      inject: [ConfigService, DATABASE_CONNECTION, EmailService],
      useFactory: (
        configService: ConfigService,
        db: NodePgDatabase<typeof schema>,
        emailService: EmailService,
      ) => ({
        betterAuthConfig: {
          allowedOrigins: configService
            .get<string>('ALLOWED_ORIGINS')
            ?.split(',') || ['http://localhost:3000'],
          betterAuthUrl:
            configService.get<string>('BETTER_AUTH_URL') ||
            'http://localhost:3000/api/auth',
          frontendUrl: configService.get<string>('FRONTEND_URL'),
          googleClientId: configService.get<string>('GOOGLE_CLIENT_ID'),
          googleClientSecret: configService.get<string>('GOOGLE_CLIENT_SECRET'),
          nodeEnv: configService.get<string>('NODE_ENV'),
        },
        constants: {
          systemTenantId: configService.getOrThrow<string>('SYSTEM_TENANT_ID'),
          ownerRoleId: configService.getOrThrow<string>('OWNER_ROLE_ID'),
          adminRoleId: configService.getOrThrow<string>('ADMIN_ROLE_ID'),
          memberRoleId: configService.getOrThrow<string>('MEMBER_ROLE_ID'),
        },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        db: db as any,
        email: emailService,
      }),
    }),
    forwardRef(() => AuthModule),
    IdentityAuthModule,
    UsersModule,
    TenantsModule,
    InvitationsModule,
    DbModule,
    SystemAdminModule,
    RolesModule,
    ConnectionsModule,
    TriggerModule,
    StorageResolverModule,
    DbManagerModule,
    WorkspacesModule,
    StitchesModule,
    SchedulerModule,
    WebhooksModule,
  ],
  controllers: [AppController],
  providers: [AppService, ShutdownService],
})
export class AppModule {}

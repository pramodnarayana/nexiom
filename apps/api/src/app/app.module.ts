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
import { StorageResolverModule, PiecesModule } from '@nexiom/engine';
import { CacheModule } from '@nexiom/cache';
import { QueueModule } from '@nexiom/queue';
import { DbManagerModule } from '../modules/dbmanager/dbmanager.module.js';
import { WorkspacesModule } from '../modules/workspaces/workspaces.module.js';
import { StitchesModule } from '../modules/stitches/stitches.module.js';
import { SchedulerModule } from '../modules/scheduler/scheduler.module.js';
import { WebhooksModule } from '../modules/webhooks/webhooks.module.js';
import { ShutdownService } from '../core/shutdown.service.js';
import { PipelineModule } from '../modules/pipeline/pipeline.module.js';
import { ObservabilityModule } from '../modules/observability/observability.module.js';
import { TraceModule } from '../modules/trace/trace.module.js';
import { ExceptionsModule } from '../modules/exceptions/exceptions.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
    }),
    // ObservabilityModule must be first so pino is active before all other modules
    // bootstrap and emit their own startup logs.
    ObservabilityModule,
    // Global Redis client — available to all modules via REDIS_CLIENT token
    CacheModule,
    // Global SQS queue — available to all modules via QUEUE_SERVICE / QueueService token
    QueueModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        infraMode: cfg.get<string>('INFRA_MODE', 'local') as
          | 'local'
          | 'production',
        endpoint: cfg.get<string>('SQS_ENDPOINT'),
        region: cfg.get<string>('AWS_REGION', 'us-east-1'),
        accountId: cfg.get<string>('AWS_ACCOUNT_ID'),
      }),
    }),
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
    PiecesModule.forRoot({ anchorUrl: import.meta.url }),
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
    PipelineModule,
    TraceModule,
    ExceptionsModule,
  ],
  controllers: [AppController],
  providers: [AppService, ShutdownService],
})
export class AppModule {}

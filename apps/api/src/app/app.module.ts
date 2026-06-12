/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { EncryptionModule } from '@soopa/security';
import { UsersModule } from '../modules/identity/users/users.module.js';
import { TenantsModule } from '../modules/identity/tenants/tenants.module.js';
import { AuthModule } from '@soopa/auth';
import { IdentityAuthModule } from '../modules/identity/auth/auth.module.js';
import { DatabaseModule } from '@soopa/database';
import { InvitationsModule } from '../modules/identity/invitations/invitations.module.js';
import { SystemAdminModule } from '../modules/identity/system-admin/system-admin.module.js';
import { RolesModule } from '../modules/identity/roles/roles.module.js';
import { IdentityModule } from '@soopa/identity';
import { EmailService } from '../modules/email/email.service.abstract.js';
import { DATABASE_CONNECTION, type DrizzleDb } from '@soopa/database';
import { ConnectionsModule } from '../modules/connections/connections.module.js';
import { TriggerModule } from '../modules/trigger/trigger.module.js';
import { EmailModule } from '../modules/email/email.module.js';
import { StorageResolverModule } from '@soopa/pipeline';
import { PiecesModule } from '@soopa/piece-registry';
import { CacheModule } from '@soopa/cache';
import { QueueModule, createQueueModuleOptions } from '@soopa/queue';
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
import { AiModule } from '../modules/ai/ai.module.js';
import { MappingsModule } from '../modules/mappings/mappings.module.js';
import { GitopsModule } from '../modules/gitops/gitops.module.js';
import { PluginsModule } from '../modules/plugins/plugins.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env', '../../.env'],
    }),
    // ObservabilityModule must be first so pino is active before all other modules
    // bootstrap and emit their own startup logs.
    ObservabilityModule,
    // Global encryption module
    EncryptionModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        mode: cfg.get('INFRA_MODE') === 'local' ? 'local' : 'kms',
        encryptionKey: cfg.get('ENCRYPTION_KEY'),
        kmsKeyId: cfg.get('KMS_KEY_ID'),
        kmsEndpoint: cfg.get('KMS_ENDPOINT'),
        region: cfg.get('KMS_REGION'),
      }),
    }),
    // Global Redis client — available to all modules via REDIS_CLIENT token
    CacheModule,
    // Global SQS queue — available to all modules via QUEUE_SERVICE / QueueService token
    QueueModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: createQueueModuleOptions,
    }),
    // Global cron scheduler — required for PollerService and DlqProcessorService
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot({ global: true }),
    IdentityModule.registerAsync({
      imports: [
        ConfigModule,
        DatabaseModule,
        forwardRef(() => AuthModule),
        EmailModule,
      ], // Ensure DatabaseModule and EmailModule are here
      inject: [ConfigService, DATABASE_CONNECTION, EmailService],
      useFactory: (
        configService: ConfigService,
        db: DrizzleDb,
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
        db: db as any,
        email: emailService,
      }),
    }),
    forwardRef(() => AuthModule),
    IdentityAuthModule,
    UsersModule,
    TenantsModule,
    InvitationsModule,
    DatabaseModule,
    PiecesModule.forRoot(),
    ...(process.env.ENABLE_PLUGIN_MIGRATIONS === 'true'
      ? [PiecesModule.withMigrations()]
      : []),
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
    AiModule,
    MappingsModule,
    GitopsModule,
    PluginsModule,
  ],
  controllers: [AppController],
  providers: [AppService, ShutdownService],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './modules/identity/users/users.module';
import { TenantsModule } from './modules/identity/tenants/tenants.module';
import { AuthModule } from './modules/identity/auth/auth.module';
import { DbModule } from './db/db.module';
import { InvitationsModule } from './modules/identity/invitations/invitations.module';
import { SystemAdminModule } from './modules/identity/system-admin/system-admin.module';
import { IdentityModule } from '@nexiom/identity';
import { EmailService } from './modules/email/email.service.abstract';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    IdentityModule.registerAsync({
      imports: [ConfigModule, DbModule, AuthModule], // Ensure DbModule is here
      inject: [ConfigService, 'DRIZZLE_DB', EmailService],
      useFactory: (
        configService: ConfigService,

        db: any,

        emailService: any,
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        db: db,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        email: emailService,
      }),
    }),
    AuthModule,
    UsersModule,
    TenantsModule,
    InvitationsModule,
    DbModule,
    SystemAdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

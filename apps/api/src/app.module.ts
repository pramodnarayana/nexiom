import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
    IdentityModule.register({
      betterAuthConfig: {
        allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || [
          'http://localhost:3000',
        ],
        betterAuthUrl:
          process.env.BETTER_AUTH_URL || 'http://localhost:3000/api/auth',
        frontendUrl: process.env.FRONTEND_URL,
        googleClientId: process.env.GOOGLE_CLIENT_ID,
        googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
        nodeEnv: process.env.NODE_ENV,
      },
      dbToken: 'DRIZZLE_DB',
      emailToken: EmailService,
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

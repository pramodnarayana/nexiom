import { forwardRef, Module, Global } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { SystemAdminGuard } from './system-admin.guard';
import { PlatformGuard } from './platform.guard';
import { EmailModule } from '../../email/email.module';
import { AuthController } from './auth.controller';
import { TenantsModule } from '../tenants/tenants.module';
import { DbModule } from '../../../db/db.module';
import { InvitationsModule } from '../invitations/invitations.module';

@Global()
@Module({
  imports: [
    EmailModule,
    TenantsModule,
    DbModule,
    forwardRef(() => InvitationsModule),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, SystemAdminGuard, PlatformGuard],
  exports: [AuthService, AuthGuard, SystemAdminGuard, PlatformGuard],
})
export class AuthModule {}

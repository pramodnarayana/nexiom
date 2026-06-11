import { forwardRef, Module, Global } from '@nestjs/common';
import { SystemAdminGuard } from './system-admin.guard.js';
import { AuthModule } from '@soopa/auth';
import { PlatformGuard } from './platform.guard.js';
import { EmailModule } from '../../email/email.module.js';
import { AuthController } from './auth.controller.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { DatabaseModule } from '@soopa/database';
import { InvitationsModule } from '../invitations/invitations.module.js';

@Global()
@Module({
  imports: [
    EmailModule,
    TenantsModule,
    DatabaseModule,
    forwardRef(() => InvitationsModule),
    AuthModule,
  ],
  controllers: [AuthController],
  providers: [SystemAdminGuard, PlatformGuard],
  exports: [SystemAdminGuard, PlatformGuard],
})
export class IdentityAuthModule {}

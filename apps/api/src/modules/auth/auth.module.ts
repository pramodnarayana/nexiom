import { Module, Global } from '@nestjs/common';
import { BetterAuthIdentityProvider } from './providers/better-auth/better-auth.provider';
import { IdentityProvider } from './identity-provider.abstract';
import { AuthGuard } from './auth.guard';
import { EmailModule } from '../email/email.module';
import { AuthController } from './auth.controller';
import { TenantsModule } from '../tenants/tenants.module';
import { DbModule } from '../../db/db.module';

@Global()
@Module({
  imports: [EmailModule, TenantsModule, DbModule],
  controllers: [AuthController],
  providers: [
    BetterAuthIdentityProvider,
    {
      provide: IdentityProvider, // The token expected by UsersService / Guard
      useExisting: BetterAuthIdentityProvider,
    },
    AuthGuard,
  ],
  exports: [IdentityProvider, AuthGuard],
})
export class AuthModule {}

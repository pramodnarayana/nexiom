import { Module, Global } from '@nestjs/common';
import { BetterAuthIdentityProvider } from './better-auth.provider';
import { IdentityProvider } from './identity-provider.abstract';
import { AuthGuard } from './auth.guard';
import { EmailModule } from '../shared/email/email.module';
import { AuthController } from './auth.controller';

@Global()
@Module({
  imports: [EmailModule],
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

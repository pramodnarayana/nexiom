import { Module, forwardRef } from '@nestjs/common';
import { UsersController } from './users.controller';
import { InvitationsModule } from '../invitations/invitations.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [InvitationsModule, forwardRef(() => AuthModule)],
  controllers: [UsersController],
  providers: [],
})
export class UsersModule {}

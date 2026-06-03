import { Module, forwardRef } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { InvitationsModule } from '../invitations/invitations.module.js';
import { AuthModule } from '@soopa/auth';

@Module({
  imports: [InvitationsModule, forwardRef(() => AuthModule)],
  controllers: [UsersController],
  providers: [],
})
export class UsersModule {}

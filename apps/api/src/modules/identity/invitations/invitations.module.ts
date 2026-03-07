import { Module, forwardRef } from '@nestjs/common';
import { InvitationsService } from './invitations.service.js';
import { InvitationsController } from './invitations.controller.js';
import { AuthModule } from '@nexiom/auth';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}

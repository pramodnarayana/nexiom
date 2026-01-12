import { Injectable, Logger } from '@nestjs/common';
import { IdentityProvider } from '../auth/identity-provider.abstract';
import { CreateInvitation } from './invitations.validation';

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(private readonly identityProvider: IdentityProvider) {}

  async create(
    createInvitation: CreateInvitation,
    inviterId: string,
  ): Promise<unknown> {
    this.logger.log(`Creating invitation for ${createInvitation.email}`);
    return this.identityProvider.createInvitation({
      email: createInvitation.email,
      role: createInvitation.role,
      organizationId: createInvitation.organizationId || null,
      inviterId,
    });
  }

  async accept(invitationId: string, userId: string): Promise<unknown> {
    this.logger.log(`Accepting invitation ${invitationId} for user ${userId}`);
    return this.identityProvider.acceptInvitation(invitationId, userId);
  }

  async get(id: string): Promise<unknown> {
    return this.identityProvider.getInvitation(id);
  }
}

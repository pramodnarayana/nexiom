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
    headers?: Record<string, any>,
  ): Promise<unknown> {
    this.logger.log(
      `Creating invitation for organization ${createInvitation.organizationId || 'system'}`,
    );
    return this.identityProvider.createInvitation({
      email: createInvitation.email,
      role: createInvitation.role,
      organizationId: createInvitation.organizationId || null,
      inviterId,
      headers,
    });
  }

  async accept(
    invitationId: string,
    userId: string,
    headers?: Record<string, any>,
  ): Promise<unknown> {
    this.logger.log(`Accepting invitation ${invitationId} for user ${userId}`);
    return this.identityProvider.acceptInvitation(
      invitationId,
      userId,
      headers,
    );
  }

  async get(id: string, headers?: Record<string, any>): Promise<unknown> {
    return this.identityProvider.getInvitation(id, headers);
  }

  async list(organizationId: string): Promise<unknown[]> {
    return this.identityProvider.listInvitations(organizationId);
  }
}

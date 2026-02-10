import { Injectable, Logger, Inject } from '@nestjs/common';
import { AUTH_PROVIDER, IAuthProvider, Invitation } from '@nexiom/identity';
import { CreateInvitation } from './invitations.validation';

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);
  private static readonly INVITATION_EXPIRES_IN_SECONDS = 48 * 3600;

  constructor(
    @Inject(AUTH_PROVIDER) private readonly authProvider: IAuthProvider,
  ) {}

  async create(
    createInvitation: CreateInvitation,
    inviterId: string,
    headers?: Record<string, string | string[] | undefined>,
  ): Promise<Invitation> {
    this.logger.log(
      `Creating invitation for organization ${createInvitation.organizationId || 'system'}`,
    );
    return this.authProvider.createInvitation({
      email: createInvitation.email,
      role: createInvitation.role,
      organizationId: createInvitation.organizationId || null,
      inviterId,
      expiresIn: InvitationsService.INVITATION_EXPIRES_IN_SECONDS,
      headers,
    });
  }

  async accept(invitationId: string, userId: string): Promise<void> {
    this.logger.log(`Accepting invitation ${invitationId} for user ${userId}`);
    return this.authProvider.acceptInvitation(invitationId, userId);
  }

  async get(id: string): Promise<Invitation | null> {
    return this.authProvider.getInvitation(id);
  }

  async list(organizationId: string): Promise<Invitation[]> {
    return this.authProvider.listInvitations(organizationId);
  }
}

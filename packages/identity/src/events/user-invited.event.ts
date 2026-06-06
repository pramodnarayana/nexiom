export class UserInvitedEvent {
  constructor(
    public readonly invitationId: string,
    public readonly email: string,
    public readonly tenantId: string,
    public readonly role: string,
  ) {}
}

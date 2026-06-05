export class CredentialInvalidatedEvent {
  constructor(
    public readonly credentialId: string,
    public readonly reason: string,
    public readonly providerId: string,
  ) {}
}

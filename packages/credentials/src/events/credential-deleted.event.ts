export class CredentialDeletedEvent {
  constructor(
    public readonly credentialId: string,
    public readonly tenantId: string,
    public readonly dataSourceId: string,
  ) {}
}

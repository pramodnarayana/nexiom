export class CredentialRefreshedEvent {
  constructor(
    public readonly credentialId: string,
    public readonly tenantId: string,
    public readonly dataSourceId: string,
    public readonly expiresAt: Date | null,
  ) {}
}

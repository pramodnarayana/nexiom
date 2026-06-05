export class TenantProvisionedEvent {
  constructor(
    public readonly tenantId: string,
    public readonly ownerId: string,
    public readonly organizationName: string,
  ) {}
}

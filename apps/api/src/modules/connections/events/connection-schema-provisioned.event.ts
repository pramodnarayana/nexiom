export class ConnectionSchemaProvisionedEvent {
  constructor(
    public readonly tenantId: string,
    public readonly dataSourceId: string,
    public readonly schemaName: string,
  ) {}
}

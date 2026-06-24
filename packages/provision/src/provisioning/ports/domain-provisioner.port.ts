export const DOMAIN_PROVISIONER = Symbol('DOMAIN_PROVISIONER');

export interface DomainProvisionerPort {
  provisionDomainSchema(tenantId: string, schemaName: string, appName: string): Promise<void>;
}

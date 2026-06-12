import type {
  DatabaseProvisionerPort,
  ProvisionPlanParams,
} from '../ports/outbound/database-provisioner.port.js';

export class FakeDatabaseProvisioner implements DatabaseProvisionerPort {
  public callCount = {
    applyPlan: 0,
    registerPublication: 0,
    unregisterPublication: 0,
  };
  public appliedPlans: ProvisionPlanParams[] = [];
  public registeredPublications = new Set<string>();
  public failUnregister = false;

  applyPlan(params: ProvisionPlanParams): Promise<void> {
    this.callCount.applyPlan++;
    this.appliedPlans.push(params);
    return Promise.resolve();
  }

  registerPublication(schemaName: string): Promise<void> {
    this.callCount.registerPublication++;
    this.registeredPublications.add(schemaName);
    return Promise.resolve();
  }

  unregisterPublication(schemaName: string): Promise<void> {
    this.callCount.unregisterPublication++;
    if (this.failUnregister) {
      return Promise.reject(
        new Error(
          `FakeDatabaseProvisioner: Simulated failure for unregisterPublication`,
        ),
      );
    }
    this.registeredPublications.delete(schemaName);
    return Promise.resolve();
  }
}

import type { TriggerStorageResolverPort } from '../ports/outbound/trigger-storage-resolver.port.js';

export class FakeTriggerStorageResolver implements TriggerStorageResolverPort {
  public callCount = { resolveSchemaName: 0 };
  public overrides = new Map<string, string>();
  public failResolution = false;

  resolveSchemaName(dataSourceId: string): Promise<string> {
    this.callCount.resolveSchemaName++;
    if (this.failResolution) {
      return Promise.reject(
        new Error(
          `FakeTriggerStorageResolver: Simulated failure for ${dataSourceId}`,
        ),
      );
    }
    return Promise.resolve(
      this.overrides.get(dataSourceId) || `schema_for_${dataSourceId}`,
    );
  }
}

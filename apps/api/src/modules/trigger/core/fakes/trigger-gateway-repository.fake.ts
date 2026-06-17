import type {
  TriggerGatewayRepositoryPort,
  InsertGatewayRowParams,
} from '../ports/outbound/trigger-gateway-repository.port.js';

export class FakeTriggerGatewayRepository implements TriggerGatewayRepositoryPort {
  public callCount = { insertGatewayRow: 0, updateSchemaPlan: 0 };
  public schemaPlans = new Map<string, string>();
  public insertedRows: InsertGatewayRowParams[] = [];
  public failInserts = false;

  insertGatewayRow(
    _schemaName: string,
    params: InsertGatewayRowParams,
  ): Promise<boolean> {
    this.callCount.insertGatewayRow++;
    if (this.failInserts) return Promise.resolve(false);
    this.insertedRows.push(params);
    return Promise.resolve(true);
  }

  updateSchemaPlan(dataSourceId: string, schemaPlan: string): Promise<void> {
    this.callCount.updateSchemaPlan++;
    this.schemaPlans.set(dataSourceId, schemaPlan);
    return Promise.resolve();
  }
}

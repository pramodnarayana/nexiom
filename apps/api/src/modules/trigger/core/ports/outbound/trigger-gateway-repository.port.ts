export interface InsertGatewayRowParams {
  dataSourceId: string;
  objectType: string | undefined;
  payload: unknown;
  extReqId: string;
}

export interface TriggerGatewayRepositoryPort {
  /**
   * Inserts a record into inbound_gateway and inbound_outbox.
   * Returns true if inserted, false if skipped due to conflict.
   */
  insertGatewayRow(
    schemaName: string,
    params: InsertGatewayRowParams,
  ): Promise<boolean>;

  /**
   * Updates the schema plan state for the data source.
   */
  updateSchemaPlan(dataSourceId: string, schemaPlan: string): Promise<void>;
}

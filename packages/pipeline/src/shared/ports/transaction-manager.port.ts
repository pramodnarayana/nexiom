export type TxContext = any;

export interface TransactionManagerPort {
  /**
   * Executes the given work within a transaction scoped to the tenant and schema.
   */
  runInTenantTransaction<T>(
    tenantId: string,
    schemaName: string,
    work: (tx: TxContext) => Promise<T>
  ): Promise<T>;

  /**
   * Executes the given work within a nested transaction (savepoint) using the parent context.
   */
  runNestedTransaction<T>(
    parentTx: TxContext,
    work: (nestedTx: TxContext) => Promise<T>
  ): Promise<T>;
}

export const TRANSACTION_MANAGER_PORT = Symbol('TRANSACTION_MANAGER_PORT');

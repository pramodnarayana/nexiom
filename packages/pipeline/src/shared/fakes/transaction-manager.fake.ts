import { TransactionManagerPort, TxContext } from "../ports/transaction-manager.port.js";

export class FakeTransactionManager implements TransactionManagerPort {
  async runInTenantTransaction<T>(tenantId: string, schemaName: string, work: (tx: TxContext) => Promise<T>): Promise<T> {
    const dummyTx = { _isFakeTx: true, tenantId, schemaName };
    return work(dummyTx);
  }

  async runNestedTransaction<T>(parentTx: TxContext, work: (nestedTx: TxContext) => Promise<T>): Promise<T> {
    const nestedTx = { ...parentTx, _isNested: true };
    return work(nestedTx);
  }
}

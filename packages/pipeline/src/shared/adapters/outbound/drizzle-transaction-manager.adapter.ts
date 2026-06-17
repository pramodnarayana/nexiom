import { Injectable, Inject } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { assertValidSchemaName } from "@soopa/database";
import { DB_MANAGER, type DatabaseManager } from "@soopa/dbmanager";
import { TransactionManagerPort } from '../../ports/transaction-manager.port.js';

@Injectable()
export class DrizzleTransactionManagerAdapter implements TransactionManagerPort {
  constructor(
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  async runInTenantTransaction<T>(
    tenantId: string,
    schemaName: string,
    work: (tx: any) => Promise<T>
  ): Promise<T> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    
    return await tenantDb.transaction(async (tx) => {
      assertValidSchemaName(schemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );
      
      return await work(tx);
    });
  }

  async runNestedTransaction<T>(
    parentTx: any,
    work: (nestedTx: any) => Promise<T>
  ): Promise<T> {
    // Drizzle exposes a .transaction() method on existing transaction objects (savepoint)
    if (typeof parentTx.transaction !== 'function') {
      throw new Error("Provided TxContext does not support nested transactions.");
    }
    return await parentTx.transaction(async (sp: any) => {
      return await work(sp);
    });
  }
}

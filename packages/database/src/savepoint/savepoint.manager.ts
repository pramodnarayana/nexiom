import { sql } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import { Injectable } from '@nestjs/common';

export const SAVEPOINT_MANAGER = 'SAVEPOINT_MANAGER';

export interface ISavePointManager {
  createSavepoint(tx: PgTransaction<NodePgQueryResultHKT, any, any>, name: string): Promise<void>;
  releaseSavepoint(tx: PgTransaction<NodePgQueryResultHKT, any, any>, name: string): Promise<void>;
  rollbackToSavepoint(tx: PgTransaction<NodePgQueryResultHKT, any, any>, name: string): Promise<void>;
}

@Injectable()
export class PostgresSavePointManager implements ISavePointManager {
  async createSavepoint(tx: PgTransaction<NodePgQueryResultHKT, any, any>, name: string): Promise<void> {
    await tx.execute(sql`SAVEPOINT ${sql.identifier(name)}`);
  }

  async releaseSavepoint(tx: PgTransaction<NodePgQueryResultHKT, any, any>, name: string): Promise<void> {
    await tx.execute(sql`RELEASE SAVEPOINT ${sql.identifier(name)}`);
  }

  async rollbackToSavepoint(tx: PgTransaction<NodePgQueryResultHKT, any, any>, name: string): Promise<void> {
    await tx.execute(sql`ROLLBACK TO SAVEPOINT ${sql.identifier(name)}`);
  }
}

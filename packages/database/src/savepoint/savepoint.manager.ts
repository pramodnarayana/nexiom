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
    this.validateSavepointName(name);
    await tx.execute(sql`SAVEPOINT ${sql.identifier(name)}`);
  }

  async releaseSavepoint(tx: PgTransaction<NodePgQueryResultHKT, any, any>, name: string): Promise<void> {
    this.validateSavepointName(name);
    await tx.execute(sql`RELEASE SAVEPOINT ${sql.identifier(name)}`);
  }

  async rollbackToSavepoint(tx: PgTransaction<NodePgQueryResultHKT, any, any>, name: string): Promise<void> {
    this.validateSavepointName(name);
    await tx.execute(sql`ROLLBACK TO SAVEPOINT ${sql.identifier(name)}`);
  }

  private validateSavepointName(name: string): void {
    if (!name || typeof name !== 'string' || name.trim() === '') {
      throw new Error('Savepoint name must be a non-empty string');
    }
    // Prevent SQL injection by validating the name only contains safe characters
    // First character must be a letter or underscore, subsequent characters can be alphanumeric or underscores
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error('Savepoint name must start with a letter or underscore and contain only alphanumeric characters and underscores');
    }
  }
}

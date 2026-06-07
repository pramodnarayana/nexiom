import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../index.js';
import type { DrizzleDb } from '../index.js';
import { SAVEPOINT_MANAGER, ISavePointManager } from '../savepoint/savepoint.manager.js';
import type { PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';

export interface RepositoryContext {
  tx?: Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
}

@Injectable()
export abstract class BaseRepository<T extends PgTable> {
  constructor(
    protected readonly db: DrizzleDb,
    protected readonly savepointManager: ISavePointManager,
    protected readonly table: T,
  ) {}

  /**
   * Executes a callback within a transaction.
   * If a transaction is already active in the context, it creates a savepoint instead.
   */
  async transaction<R>(
    cb: (ctx: RepositoryContext) => Promise<R>,
    ctx?: RepositoryContext,
  ): Promise<R> {
    if (ctx?.tx) {
      const savepointName = `sp_${crypto.randomUUID().replace(/-/g, '')}`;
      await this.savepointManager.createSavepoint(ctx.tx, savepointName);
      try {
        const result = await cb(ctx);
        await this.savepointManager.releaseSavepoint(ctx.tx, savepointName);
        return result;
      } catch (err) {
        await this.savepointManager.rollbackToSavepoint(ctx.tx, savepointName);
        throw err;
      }
    } else {
      return this.db.transaction(async (tx) => {
        return cb({ tx });
      });
    }
  }

  protected getExecutor(ctx?: RepositoryContext) {
    return ctx?.tx ?? this.db;
  }
}

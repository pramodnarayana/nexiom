import { Injectable } from '@nestjs/common';
import type { Client } from 'pg';

@Injectable()
export class PgConnectionPool {
  private static cachedPg: typeof import('pg') | null = null;

  async resolvePgModule(): Promise<{
    PgClient: typeof import('pg').Client;
    dbUrl: string;
  }> {
    PgConnectionPool.cachedPg ??= await import('pg');
    const { Client: PgClient } = PgConnectionPool.cachedPg;

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL is not defined');
    }

    return { PgClient, dbUrl };
  }

  async getPgClient(): Promise<Client> {
    const { PgClient, dbUrl } = await this.resolvePgModule();
    const client = new PgClient({ connectionString: dbUrl });
    await client.connect();
    return client;
  }

  async withClient<T>(
    client: Client | undefined,
    fn: (c: Client) => Promise<T>,
  ): Promise<T> {
    const { PgClient, dbUrl } = await this.resolvePgModule();

    const dbClient = client || new PgClient({ connectionString: dbUrl });
    const shouldClose = !client;

    if (shouldClose) {
      await dbClient.connect();
    }

    try {
      return await fn(dbClient);
    } finally {
      if (shouldClose) {
        await dbClient.end();
      }
    }
  }

  async execSql(sql: string, client?: Client): Promise<void> {
    await this.withClient(client, async (c) => {
      await c.query(sql);
    });
  }

  async querySql<T = any>(sql: string, client?: Client): Promise<T[]> {
    return this.withClient(client, async (c) => {
      const res = await c.query(sql);
      return res.rows as T[];
    });
  }

  async withDrizzle<T>(
    callback: (
      db: import('drizzle-orm/node-postgres').NodePgDatabase<
        typeof import('../schema.js')
      >,
      _schema: typeof import('../schema.js'),
    ) => Promise<T>,
  ): Promise<T> {
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const dbSchema = await import('../schema.js');
    const client = await this.getPgClient();

    try {
      const db = drizzle(client, { schema: dbSchema });
      return await callback(db, dbSchema);
    } finally {
      await client.end();
    }
  }
}

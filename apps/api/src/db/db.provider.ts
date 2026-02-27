import { Provider } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

import { DATABASE_CONNECTION } from '@nexiom/database';

export const DRIZZLE_DB = DATABASE_CONNECTION;

export const databaseProvider: Provider = {
  provide: DATABASE_CONNECTION,
  useFactory: () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not defined');
    }
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    return drizzle(pool, { schema });
  },
};

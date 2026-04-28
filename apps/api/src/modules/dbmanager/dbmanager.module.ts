import { Module, Global } from '@nestjs/common';
import { SqlDatabaseManager } from '@nexiom/dbmanager';
import { DbModule } from '../../db/db.module.js';
import { DATABASE_CONNECTION } from '@nexiom/database';
import type { DrizzleDb } from '@nexiom/database';

import { getDomainProvisioner } from '@nexiom/piece-framework';

export const DB_MANAGER = 'DATABASE_MANAGER';

@Global()
@Module({
  imports: [DbModule],
  providers: [
    {
      provide: DB_MANAGER,
      useFactory: (drizzleDb: DrizzleDb) => {
        return new SqlDatabaseManager(
          drizzleDb,
          undefined,
          getDomainProvisioner,
        );
      },
      inject: [DATABASE_CONNECTION],
    },
  ],
  exports: [DB_MANAGER],
})
export class DbManagerModule {}

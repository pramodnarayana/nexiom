import { Module, Global } from '@nestjs/common';
import { SqlDatabaseManager } from '@nexiom/dbmanager';
import { DbModule } from '../../db/db.module';
import { DATABASE_CONNECTION } from '@nexiom/database';

export const DB_MANAGER = 'DATABASE_MANAGER';

@Global()
@Module({
  imports: [DbModule],
  providers: [
    {
      provide: DB_MANAGER,
      useFactory: (drizzleDb) => {
        return new SqlDatabaseManager(drizzleDb);
      },
      inject: [DATABASE_CONNECTION],
    },
  ],
  exports: [DB_MANAGER],
})
export class DbManagerModule {}

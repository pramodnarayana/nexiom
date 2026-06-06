import { Injectable, Inject } from '@nestjs/common';
import {
  BaseRepository,
  RepositoryContext,
  credentials,
  DATABASE_CONNECTION,
  SAVEPOINT_MANAGER,
} from '@soopa/database';
import type { DrizzleDb, ISavePointManager } from '@soopa/database';
import { eq } from 'drizzle-orm';

@Injectable()
export class CredentialRepository extends BaseRepository<typeof credentials> {
  constructor(
    @Inject(DATABASE_CONNECTION) db: DrizzleDb,
    @Inject(SAVEPOINT_MANAGER) savepointManager: ISavePointManager,
  ) {
    super(db, savepointManager, credentials);
  }

  async findByDataSourceId(dataSourceId: string, ctx?: RepositoryContext) {
    const exec = this.getExecutor(ctx);
    const result = await exec
      .select()
      .from(credentials)
      .where(eq(credentials.dataSourceId, dataSourceId))
      .limit(1);
    return result[0] || null;
  }
}

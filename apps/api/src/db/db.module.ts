import { Module, Global } from '@nestjs/common';
import { databaseProvider } from './db.provider.js';

@Global()
@Module({
  providers: [databaseProvider],
  exports: [databaseProvider],
})
export class DbModule {}

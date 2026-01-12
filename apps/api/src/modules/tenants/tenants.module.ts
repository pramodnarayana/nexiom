import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { DbModule } from '../../db/db.module';

@Module({
  imports: [DbModule],
  controllers: [TenantsController],
  providers: [TenantsService],
  exports: [TenantsService], // Export for AuthModule to use
})
export class TenantsModule {}

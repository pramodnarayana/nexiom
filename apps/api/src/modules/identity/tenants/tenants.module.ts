import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';

@Module({
  imports: [],
  controllers: [TenantsController],
  providers: [],
  exports: [],
})
export class TenantsModule {}

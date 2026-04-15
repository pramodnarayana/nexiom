import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller.js';
import { TenantOffboardingService } from '../tenant-offboarding.service.js';

@Module({
  imports: [],
  controllers: [TenantsController],
  providers: [TenantOffboardingService],
  exports: [TenantOffboardingService],
})
export class TenantsModule {}

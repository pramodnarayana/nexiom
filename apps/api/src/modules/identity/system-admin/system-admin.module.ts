import { Module } from '@nestjs/common';
import { SystemAdminController } from './system-admin.controller.js';
import { UsersModule } from '../users/users.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { AuthModule } from '@nexiom/auth';

@Module({
  imports: [UsersModule, TenantsModule, AuthModule],
  controllers: [SystemAdminController],
})
export class SystemAdminModule {}

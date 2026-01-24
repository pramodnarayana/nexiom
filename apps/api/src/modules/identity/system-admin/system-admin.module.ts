import { Module } from '@nestjs/common';
import { SystemAdminController } from './system-admin.controller';
import { UsersModule } from '../users/users.module';
import { TenantsModule } from '../tenants/tenants.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [UsersModule, TenantsModule, AuthModule],
  controllers: [SystemAdminController],
})
export class SystemAdminModule {}

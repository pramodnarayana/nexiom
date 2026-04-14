import { Module } from '@nestjs/common';
import { MappingsService } from './mappings.service.js';
import { MappingsController } from './mappings.controller.js';
import { IdentityAuthModule } from '../identity/auth/auth.module.js';

@Module({
  imports: [IdentityAuthModule],
  controllers: [MappingsController],
  providers: [MappingsService],
})
export class MappingsModule {}

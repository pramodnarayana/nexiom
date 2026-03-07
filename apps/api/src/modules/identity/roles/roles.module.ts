import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller.js';

@Module({
  controllers: [RolesController],
})
export class RolesModule {}

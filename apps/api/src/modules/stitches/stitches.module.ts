import { Module } from '@nestjs/common';
import { AuthModule } from '@nexiom/auth';
import { DbModule } from '../../db/db.module.js';
import { StitchesController } from './stitches.controller.js';
import { StitchesService } from './stitches.service.js';

@Module({
  imports: [DbModule, AuthModule],
  controllers: [StitchesController],
  providers: [StitchesService],
  exports: [StitchesService],
})
export class StitchesModule {}

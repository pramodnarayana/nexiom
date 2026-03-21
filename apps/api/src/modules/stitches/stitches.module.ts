import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module.js';
import { StitchesController } from './stitches.controller.js';
import { StitchesService } from './stitches.service.js';

@Module({
  imports: [DbModule],
  controllers: [StitchesController],
  providers: [StitchesService],
  exports: [StitchesService],
})
export class StitchesModule {}

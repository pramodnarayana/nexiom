import { Module } from '@nestjs/common';
import { ApplicationExecutorService } from './application-executor.service.js';

@Module({
  providers: [ApplicationExecutorService],
  exports: [ApplicationExecutorService],
})
export class ApplicationExecutorModule {}

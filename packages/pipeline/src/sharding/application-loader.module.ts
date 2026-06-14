import { Module } from '@nestjs/common';
import { ApplicationLoaderService } from './application-loader.service.js';

@Module({
  providers: [ApplicationLoaderService],
  exports: [ApplicationLoaderService],
})
export class ApplicationLoaderModule {}

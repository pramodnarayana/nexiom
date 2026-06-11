import { Module } from '@nestjs/common';
import { ApplicationLoaderService } from './application-loader.service.js';
import { PipelineHookBrokerService } from './pipeline-hook-broker.service.js';

@Module({
  providers: [ApplicationLoaderService, PipelineHookBrokerService],
  exports: [ApplicationLoaderService, PipelineHookBrokerService],
})
export class ApplicationLoaderModule {}

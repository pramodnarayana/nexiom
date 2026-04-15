import { Module } from '@nestjs/common';
import { LogicResolverService } from './logic-resolver.service.js';

@Module({
  providers: [LogicResolverService],
  exports: [LogicResolverService],
})
export class LogicResolverModule {}

import { Module } from '@nestjs/common';
import { McpSchemaBuilderService } from './builder/mcp-schema-builder.service.js';

@Module({
  providers: [McpSchemaBuilderService],
  exports: [McpSchemaBuilderService],
})
export class McpModule {}

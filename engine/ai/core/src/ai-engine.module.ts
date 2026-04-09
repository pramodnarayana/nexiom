import { Module } from '@nestjs/common';
import { PiecesModule, MetadataModule } from '@nexiom/piece-registry';
import { OrchestratorService } from './services/orchestrator.service.js';

@Module({
  imports: [PiecesModule, MetadataModule],
  providers: [OrchestratorService],
  exports: [OrchestratorService],
})
export class AiEngineModule {}

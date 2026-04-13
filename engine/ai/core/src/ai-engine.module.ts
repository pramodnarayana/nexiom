import { Module } from '@nestjs/common';
import { PiecesModule, MetadataModule } from '@nexiom/piece-registry';
import { DatabaseModule } from '@nexiom/database';
import { OrchestratorService } from './runtime/orchestrator.service.js';
import { MappingService } from './categories/mapping.service.js';
import { HydratorToolFactory } from './tools/hydrator-tool.factory.js';
import { ActionToolFactory } from './tools/action-tool.factory.js';
import { IntentClassifierService } from './planner/intent-classifier.service.js';
import { TransformationEngine } from '@nexiom/transformer';
import { TransformerSimulationService } from './services/transformer-simulation.service.js';
import { ChatPersistenceService } from './services/chat-persistence.service.js';

@Module({
  imports: [PiecesModule, MetadataModule, DatabaseModule],
  providers: [
    OrchestratorService,
    TransformerSimulationService,
    ChatPersistenceService,
    MappingService,
    IntentClassifierService,
    HydratorToolFactory,
    ActionToolFactory,
    {
      provide: TransformationEngine,
      useValue: new TransformationEngine(),
    },
  ],
  exports: [OrchestratorService, TransformerSimulationService, ChatPersistenceService],
})
export class AiEngineModule {}

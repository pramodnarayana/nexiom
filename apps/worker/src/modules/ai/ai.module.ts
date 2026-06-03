import { Module } from "@nestjs/common";
import { AiEngineModule } from "@soopa/ai-engine";
import { CopilotWorker } from "./copilot.worker.js";

@Module({
  imports: [AiEngineModule],
  providers: [CopilotWorker],
})
export class AiWorkerModule {}

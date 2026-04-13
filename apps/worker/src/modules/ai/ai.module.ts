import { Module } from "@nestjs/common";
import { AiEngineModule } from "@nexiom/ai-engine";
import { CopilotWorker } from "./copilot.worker.js";

@Module({
  imports: [AiEngineModule],
  providers: [CopilotWorker],
})
export class AiWorkerModule {}

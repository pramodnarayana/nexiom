import { Module } from "@nestjs/common";
import { PipelineModule } from "./modules/pipeline/pipeline.module.js";
import { ConfigModule } from "@nestjs/config";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PipelineModule],
  controllers: [],
  providers: [],
})
export class AppModule {}

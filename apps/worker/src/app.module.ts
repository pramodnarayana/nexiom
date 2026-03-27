import { Module } from "@nestjs/common";
import { PipelineModule } from "./modules/pipeline/pipeline.module.js";
import { ConfigModule } from "@nestjs/config";
import { PiecesModule } from "@nexiom/engine";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PiecesModule.forRoot({ anchorUrl: import.meta.url }),
    PipelineModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}

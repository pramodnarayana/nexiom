import { Module, Global } from "@nestjs/common";
import { LoggerModule } from "@soopa/observability";

@Global()
@Module({
  imports: [LoggerModule.forRoot("app-worker") as any],
})
export class ObservabilityModule {}

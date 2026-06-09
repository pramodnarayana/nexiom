import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { QueueModule } from "@soopa/queue";
import { PiecesModule } from "@soopa/piece-registry";
import { DatabaseModule } from "@soopa/database";
import { AppInstallerProcessor } from "./app-installer.processor.js";
import { AppUpdaterCron } from "./app-updater.cron.js";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    QueueModule,
    PiecesModule,
    DatabaseModule,
  ],
  providers: [AppInstallerProcessor, AppUpdaterCron],
})
export class PiecesWorkerModule {}

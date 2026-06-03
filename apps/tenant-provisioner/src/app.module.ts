import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { QueueModule, createQueueModuleOptions } from "@soopa/queue";
import { ProvisionerModule } from "./modules/provisioner/provisioner.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env", "../../.env"],
    }),
    QueueModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: createQueueModuleOptions,
    }),
    ProvisionerModule,
  ],
})
export class AppModule {}

import { ConfigService } from "@nestjs/config";
import type { QueueModuleOptions } from "./queue.module.js";

export function createQueueModuleOptions(
  cfg: ConfigService,
): QueueModuleOptions {
  return {
    infraMode: cfg.get<string>("INFRA_MODE", "local") as "local" | "production",
    endpoint: cfg.get<string>("SQS_ENDPOINT"),
    region: cfg.get<string>("AWS_REGION", "us-east-1"),
    accountId: cfg.get<string>("AWS_ACCOUNT_ID"),
  };
}

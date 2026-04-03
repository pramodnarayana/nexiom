import { ConfigService } from "@nestjs/config";
import type { QueueModuleOptions } from "./queue.module.js";

export function createQueueModuleOptions(
  cfg: ConfigService,
): QueueModuleOptions {
  const infraMode = cfg.get<string>("INFRA_MODE", "local");
  if (infraMode !== "local" && infraMode !== "production") {
    throw new Error(
      `Invalid INFRA_MODE "${infraMode}". Expected "local" or "production".`,
    );
  }
  return {
    infraMode,
    endpoint: cfg.get<string>("SQS_ENDPOINT"),
    region: cfg.get<string>("AWS_REGION", "us-east-1"),
    accountId: cfg.get<string>("AWS_ACCOUNT_ID"),
    enabled: cfg.get<string>("QUEUE_ENABLED", "true") !== "false",
  };
}

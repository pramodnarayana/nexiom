import { Logger } from "@nestjs/common";
import type {
  GitRepositoryPort,
  CacheInvalidatorPort,
} from "../../ports/outbound/gitops-ports.js";

export class SyncGitopsShardUseCase {
  private readonly logger = new Logger(SyncGitopsShardUseCase.name);

  constructor(
    private readonly gitRepo: GitRepositoryPort,
    private readonly cacheInvalidator: CacheInvalidatorPort,
  ) {}

  async executeAll(): Promise<void> {
    this.logger.debug("Starting GitOps shard synchronization...");

    const shards = await this.gitRepo.listShards();

    if (shards.length === 0) {
      this.logger.debug("No active shard directories found for gitops sync.");
      return;
    }

    for (const shard of shards) {
      await this.executeSingle(shard);
    }
  }

  async executeSingle(shardName: string): Promise<void> {
    this.logger.debug(`Synchronizing shard: ${shardName}`);

    const result = await this.gitRepo.pull(shardName);

    if (!result.success) {
      this.logger.warn(
        `[${shardName}] Not a git repository or git pull failed — skipping.`,
        result.output,
      );
      return;
    }

    if (!result.pulledNewCommits) {
      this.logger.debug(`[${shardName}] Already up to date.`);
    } else {
      this.logger.log(
        `[${shardName}] New commits pulled — invalidating module cache:\n${result.output}`,
      );
      await this.cacheInvalidator.invalidate(shardName);
    }
  }
}

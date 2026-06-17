/* eslint-disable @typescript-eslint/require-await */
import type {
  GitRepositoryPort,
  CacheInvalidatorPort,
  PullResult,
} from "../ports/outbound/gitops-ports.js";

export class FakeGitRepository implements GitRepositoryPort {
  public shards: string[] = [];
  public pullResults = new Map<string, PullResult>();

  async listShards(): Promise<string[]> {
    return this.shards;
  }

  async pull(shardName: string): Promise<PullResult> {
    const result = this.pullResults.get(shardName);
    if (!result) {
      return { success: false, pulledNewCommits: false, output: "Not found" };
    }
    return result;
  }
}

export class FakeCacheInvalidator implements CacheInvalidatorPort {
  public invalidatedShards: string[] = [];

  async invalidate(shardName: string): Promise<void> {
    this.invalidatedShards.push(shardName);
  }
}

export interface PullResult {
  success: boolean;
  pulledNewCommits: boolean;
  output: string;
}

export interface GitRepositoryPort {
  /**
   * Returns a list of shard names available locally.
   */
  listShards(): Promise<string[]>;

  /**
   * Pulls the latest commits for a given shard.
   * Resolves with success=false if it's not a git repository or pull fails.
   */
  pull(shardName: string): Promise<PullResult>;
}

export interface CacheInvalidatorPort {
  invalidate(shardName: string): Promise<void>;
}

import { describe, it, expect, beforeEach } from "vitest";
import { SyncGitopsShardUseCase } from "./sync-gitops-shard.use-case.js";
import {
  FakeGitRepository,
  FakeCacheInvalidator,
} from "../../fakes/fake-gitops-ports.js";

describe("SyncGitopsShardUseCase", () => {
  let gitRepo: FakeGitRepository;
  let cacheInvalidator: FakeCacheInvalidator;
  let useCase: SyncGitopsShardUseCase;

  beforeEach(() => {
    gitRepo = new FakeGitRepository();
    cacheInvalidator = new FakeCacheInvalidator();
    useCase = new SyncGitopsShardUseCase(gitRepo, cacheInvalidator);
  });

  it("should pull shards and invalidate cache if new commits were pulled", async () => {
    gitRepo.shards = ["shard-1", "shard-2"];
    gitRepo.pullResults.set("shard-1", {
      success: true,
      pulledNewCommits: true,
      output: "Fast-forward...",
    });
    gitRepo.pullResults.set("shard-2", {
      success: true,
      pulledNewCommits: false,
      output: "Already up to date.",
    });

    await useCase.executeAll();

    expect(cacheInvalidator.invalidatedShards).toHaveLength(1);
    expect(cacheInvalidator.invalidatedShards).toContain("shard-1");
  });

  it("should handle single shard pull without invalidating if not a git repo", async () => {
    gitRepo.pullResults.set("shard-1", {
      success: false,
      pulledNewCommits: false,
      output: "fatal: not a git repository",
    });

    await useCase.executeSingle("shard-1");

    expect(cacheInvalidator.invalidatedShards).toHaveLength(0);
  });

  it("should return early if no active shards are found", async () => {
    gitRepo.shards = [];

    await useCase.executeAll();

    expect(cacheInvalidator.invalidatedShards).toHaveLength(0);
  });
});

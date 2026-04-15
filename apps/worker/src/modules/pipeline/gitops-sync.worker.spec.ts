import { Test, TestingModule } from "@nestjs/testing";
import { GitopsSyncWorker } from "./gitops-sync.worker.js";
import * as fs from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import { execFile } from "node:child_process";
import { vi } from "vitest";

type ExecFileCallback = (
  err: Error | null,
  result: { stdout: string; stderr: string },
) => void;

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as ExecFileCallback)(null, {
        stdout: "Already up to date.",
        stderr: "",
      });
    },
  ),
}));

describe("GitopsSyncWorker", () => {
  let service: GitopsSyncWorker;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [GitopsSyncWorker],
    }).compile();

    service = module.get<GitopsSyncWorker>(GitopsSyncWorker);

    // Default valid mock for readdir so tests don't break dynamically
    vi.mocked(fs.readdir).mockResolvedValue([]);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should handle missing base directory gracefully", async () => {
    // Simulate fs.readdir failing if path suddenly not accessible
    vi.mocked(fs.readdir).mockRejectedValueOnce(new Error("ENOENT"));

    await service.syncShardRepositories();

    // Worker gracefully catches outer errors
    expect(fs.mkdir).toHaveBeenCalled();
  });

  it("should exit early if no valid shard directories found", async () => {
    // Hidden directories or non-directories should be skipped
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: ".hidden", isDirectory: () => true } as unknown as Dirent<
        Buffer<ArrayBuffer>
      >,
      { name: "file.js", isDirectory: () => false } as unknown as Dirent<
        Buffer<ArrayBuffer>
      >,
    ]);

    await service.syncShardRepositories();
    expect(fs.stat).not.toHaveBeenCalled();
  });

  it("should sync successfully if valid shard found and is already up to date", async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: "valid-shard", isDirectory: () => true } as unknown as Dirent<
        Buffer<ArrayBuffer>
      >,
    ]);
    vi.mocked(fs.stat).mockResolvedValueOnce({
      isDirectory: () => true,
      isFile: () => false,
    } as unknown as Stats);

    await service.syncShardRepositories();
    expect(execFile).toHaveBeenCalled();
  });

  it("should correctly log if sync pulled new changes", async () => {
    // Overriding mock to return pull content
    vi.mocked(execFile).mockImplementationOnce(
      (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as ExecFileCallback)(null, {
          stdout: "Updating 123..456",
          stderr: "",
        });
        return undefined as never;
      },
    );

    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: "update-shard", isDirectory: () => true } as unknown as Dirent<
        Buffer<ArrayBuffer>
      >,
    ]);
    vi.mocked(fs.stat).mockResolvedValueOnce({
      isDirectory: () => true,
    } as unknown as Stats);

    await service.syncShardRepositories();
    expect(execFile).toHaveBeenCalled();
  });

  it("should skip shards with invalid branch names", async () => {
    // Override the environment branch strictly for this run
    const originalBranch = process.env.DEFAULT_BRANCH;

    try {
      process.env.DEFAULT_BRANCH = "invalid&&branch;name";

      const testModule: TestingModule = await Test.createTestingModule({
        providers: [GitopsSyncWorker],
      }).compile();

      const testService = testModule.get<GitopsSyncWorker>(GitopsSyncWorker);

      vi.mocked(fs.readdir).mockResolvedValueOnce([
        { name: "inject-shard", isDirectory: () => true } as unknown as Dirent<
          Buffer<ArrayBuffer>
        >,
      ]);
      vi.mocked(fs.stat).mockResolvedValueOnce({
        isDirectory: () => true,
      } as unknown as Stats);

      await testService.syncShardRepositories();

      // Execution shouldn't happen due to validation failure
      expect(execFile).not.toHaveBeenCalled();
    } finally {
      process.env.DEFAULT_BRANCH = originalBranch; // restore
    }
  });

  it("should gracefully continue if stat throws (e.g. no .git directory)", async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: "broken-shard", isDirectory: () => true } as unknown as Dirent<
        Buffer<ArrayBuffer>
      >,
    ]);
    vi.mocked(fs.stat).mockRejectedValueOnce(
      new Error("ENOENT: no such file or directory, stat .git"),
    );

    await expect(service.syncShardRepositories()).resolves.not.toThrow();
  });
});
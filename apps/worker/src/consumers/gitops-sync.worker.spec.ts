/* eslint-disable */
import { Test, TestingModule } from "@nestjs/testing";
import { GitopsSyncWorker } from "./gitops-sync.worker.js";
import {} from "@soopa/pipeline";
import { ApplicationLoaderService } from "@soopa/pipeline";
import { QueueService } from "@soopa/queue";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
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

vi.mock("node:fs", () => ({
  default: {
    watch: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis() }),
    existsSync: vi.fn().mockReturnValue(true),
  },
  watch: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis() }),
  existsSync: vi.fn().mockReturnValue(true),
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
  let invalidateCacheSpy: ReturnType<typeof vi.fn>;
  let queueConsumeSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    invalidateCacheSpy = vi.fn();
    queueConsumeSpy = vi.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitopsSyncWorker,
        {
          provide: ApplicationLoaderService,
          useValue: { invalidateCache: invalidateCacheSpy },
        },
        {
          provide: QueueService,
          useValue: { consume: queueConsumeSpy, send: vi.fn() },
        },
      ],
    }).compile();

    service = module.get<GitopsSyncWorker>(GitopsSyncWorker);

    // Default valid mock for readdir so tests don't break dynamically
    vi.mocked(fs.readdir).mockResolvedValue([]);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should subscribe to GitopsQueue on init", () => {
    service.onModuleInit();
    expect(queueConsumeSpy).toHaveBeenCalledWith(
      "gitops-queue",
      expect.any(Function),
    );
  });

  it("should handle missing base directory gracefully", async () => {
    vi.mocked(fs.readdir).mockRejectedValueOnce(new Error("ENOENT"));
    await service.syncShardRepositories();
    expect(fs.mkdir).toHaveBeenCalled();
  });

  it("should exit early if no valid shard directories found", async () => {
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

  it("should correctly invalidate cache when sync pulls new changes", async () => {
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

    // Verify the module cache is invalidated so the new code is hot-reloaded
    expect(invalidateCacheSpy).toHaveBeenCalledWith("update-shard");
  });

  it("should skip shards with invalid branch names", async () => {
    const originalBranch = process.env.DEFAULT_BRANCH;

    try {
      process.env.DEFAULT_BRANCH = "invalid&&branch;name";

      const testModule: TestingModule = await Test.createTestingModule({
        providers: [
          GitopsSyncWorker,
          {
            provide: ApplicationLoaderService,
            useValue: { invalidateCache: vi.fn() },
          },
          {
            provide: QueueService,
            useValue: { consume: vi.fn(), send: vi.fn() },
          },
        ],
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
      process.env.DEFAULT_BRANCH = originalBranch;
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

  it("should setup local file watcher if NODE_ENV is development", async () => {
    const origEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      service.onModuleInit();
      // It should call fs.mkdir in setupLocalFileWatcher
      // Wait for async setup to run
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fs.mkdir).toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it("should process queue messages successfully", async () => {
    service.onModuleInit();
    const handler = queueConsumeSpy.mock.calls[0][1];
    vi.mocked(fs.readdir).mockResolvedValueOnce([]); // Mock sync success
    await expect(handler()).resolves.not.toThrow();
  });

  it("should skip queue sync if sync is already running", async () => {
    service.onModuleInit();
    const handler = queueConsumeSpy.mock.calls[0][1];
    (service as any).isSyncRunning = true;
    await expect(handler()).rejects.toThrow("GitOps sync already in progress");
    (service as any).isSyncRunning = false;
  });

  it("should skip cron sync if sync is already running", async () => {
    (service as any).isSyncRunning = true;
    await service.syncShardRepositories();
    // Readdir shouldn't be called if it exited early
    expect(fs.readdir).not.toHaveBeenCalled();
    (service as any).isSyncRunning = false;
  });

  it("should catch and log errors in queue consumer", async () => {
    const error = new Error("Sync failed");
    vi.spyOn(service as any, "syncShardRepositories").mockRejectedValueOnce(
      error,
    );
    const loggerErrorSpy = vi.spyOn((service as any).logger, "error");

    service.onModuleInit();
    const handler = queueConsumeSpy.mock.calls[0][1];

    await expect(handler({})).rejects.toThrow("Sync failed");
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "GitOps sync failed via queue message",
      error,
    );
  });

  it("should trigger invalidateCache when file watcher fires", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      await service.onModuleInit();
      const watcherCallback = (fsSync.watch as any).mock.calls[0][2];

      // simulate file change
      watcherCallback("change", "test-shard/index.ts");

      expect(invalidateCacheSpy).toHaveBeenCalledWith("test-shard");
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("should not trigger invalidateCache for hidden files", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      await service.onModuleInit();
      const watcherCallback = (fsSync.watch as any).mock.calls[0][2];

      invalidateCacheSpy.mockClear();
      watcherCallback("change", ".env");

      expect(invalidateCacheSpy).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("should handle file watcher errors", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      const loggerErrorSpy = vi.spyOn((service as any).logger, "error");
      await service.onModuleInit();

      const watcherOptions = (fsSync.watch as any).mock.results[0].value;
      const errorCallback = watcherOptions.on.mock.calls.find(
        (c: any) => c[0] === "error",
      )[1];

      errorCallback(new Error("Watcher failed"));
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        "Local file watcher error",
        expect.any(Error),
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("should handle setupLocalFileWatcher catch block", async () => {
    const loggerErrorSpy = vi.spyOn((service as any).logger, "error");
    vi.mocked(fs.mkdir).mockRejectedValueOnce(new Error("MKDIR failed"));

    await (service as any).setupLocalFileWatcher();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "Failed to setup local file watcher",
      expect.any(Error),
    );
  });

  it("should reject path traversal in syncShard", async () => {
    await expect(service.syncShard("../outside-shard")).rejects.toThrow(
      "escapes trusted boundary",
    );
  });
});

import { Injectable, Logger, Inject, OnModuleInit } from "@nestjs/common";
import { ApplicationLoaderService } from "@soopa/pipeline";
import { QueueService, QueueName } from "@soopa/queue";
import { Cron, CronExpression } from "@nestjs/schedule";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { watch } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

@Injectable()
export class GitopsSyncWorker implements OnModuleInit {
  private readonly logger = new Logger(GitopsSyncWorker.name);
  private readonly SHARD_BASE_PATH =
    process.env.SHARD_APPLICATION_PATH ||
    path.resolve(process.cwd(), "../../engine/sync/application");
  private readonly DEFAULT_BRANCH = process.env.DEFAULT_BRANCH || "main";
  private isSyncRunning = false;

  constructor(
    @Inject(ApplicationLoaderService)
    private readonly applicationLoaderService: ApplicationLoaderService,
    private readonly queueService: QueueService,
  ) {}

  /**
   * Subscribe to the GitopsQueue on startup.
   * Messages arrive immediately when the API receives a GitHub/GitLab webhook push.
   * This ensures new application code is live within seconds of a git push.
   */
  onModuleInit() {
    if (process.env.NODE_ENV === "development") {
      void this.setupLocalFileWatcher();
    }

    this.queueService.consume(QueueName.GitopsQueue, async () => {
      this.logger.log(
        "GitOps webhook event received — triggering immediate sync",
      );

      // Check reentrancy guard before processing
      if (this.isSyncRunning) {
        this.logger.warn(
          "Skipping GitOps sync — previous run still in progress",
        );
        throw new Error(
          "GitOps sync already in progress — message will be retried",
        );
      }

      try {
        await this.syncShardRepositories();
      } catch (error) {
        this.logger.error("GitOps sync failed via queue message", error);
        throw error;
      }
    });
  }

  /**
   * Sets up a local file watcher to hot-reload application shards when edited
   * locally. This simulates the production GitOps webhook flow for developers
   * without requiring git commits or push events.
   */
  private async setupLocalFileWatcher() {
    try {
      await fs.mkdir(this.SHARD_BASE_PATH, { recursive: true });

      this.logger.log(
        `[Local Dev] Starting file watcher on ${this.SHARD_BASE_PATH} for hot-reloading shards...`,
      );
      watch(
        this.SHARD_BASE_PATH,
        { recursive: true },
        (_eventType, filename) => {
          if (!filename || filename.startsWith(".")) return;

          // Extract shard name from filename (e.g., 'mock-app-default/index.js' -> 'mock-app-default')
          const shardName = filename.split(path.sep)[0];
          if (shardName) {
            this.applicationLoaderService.invalidateCache(shardName);
          }
        },
      ).on("error", (err) => {
        this.logger.error("Local file watcher error", err);
      });
    } catch (err) {
      this.logger.error("Failed to setup local file watcher", err);
    }
  }

  /**
   * Fallback safety net — runs every 5 minutes to catch any git commits that
   * were missed (e.g. if the webhook was not delivered due to a network blip).
   *
   * The primary trigger is the webhook endpoint:
   *   POST /internal/gitops/sync  (GitopsSyncController)
   * This cron is the secondary fallback only.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async syncShardRepositories() {
    // Reentrancy guard to prevent overlapping sync runs
    if (this.isSyncRunning) {
      this.logger.warn("Skipping GitOps sync — previous run still in progress");
      return;
    }

    this.isSyncRunning = true;
    this.logger.debug(
      "Starting GitOps shard synchronization (cron fallback)...",
    );

    try {
      // Ensure the base sync directory exists
      await fs.mkdir(this.SHARD_BASE_PATH, { recursive: true });

      const entries = await fs.readdir(this.SHARD_BASE_PATH, {
        withFileTypes: true,
      });
      const shardDirs = entries.filter(
        (e) => e.isDirectory() && !e.name.startsWith("."),
      );

      if (shardDirs.length === 0) {
        this.logger.debug("No active shard directories found for gitops sync.");
        // When called from cron, we just return (this is not an error condition)
        // When called from queue, this will propagate up without throwing
        return;
      }

      for (const shard of shardDirs) {
        await this.syncShard(shard.name);
      }
    } catch (error) {
      this.logger.error("GitOps shard synchronization failed", error);
    } finally {
      this.isSyncRunning = false;
    }
  }

  /**
   * Synchronizes a single shard by running git pull.
   * Called both by the cron fallback and directly by GitopsSyncController
   * when a webhook is received from GitHub/GitLab.
   */
  async syncShard(shardName: string): Promise<void> {
    // Normalize and validate shardName to prevent path traversal
    const resolvedBasePath = path.resolve(this.SHARD_BASE_PATH);
    const repoPath = path.resolve(this.SHARD_BASE_PATH, shardName);

    // Ensure repoPath is contained within SHARD_BASE_PATH
    const relativePath = path.relative(resolvedBasePath, repoPath);
    if (
      relativePath.startsWith("..") ||
      path.isAbsolute(relativePath) ||
      !repoPath.startsWith(resolvedBasePath + path.sep)
    ) {
      this.logger.warn(
        `Path traversal attempt detected: shardName="${shardName}" escapes SHARD_BASE_PATH. Rejecting sync.`,
      );
      throw new Error(
        `Security violation: shardName escapes trusted boundary — shardName="${shardName}"`,
      );
    }

    try {
      await fs.stat(path.join(repoPath, ".git"));

      // Validate branch name to prevent command injection
      const branchName = this.DEFAULT_BRANCH;
      if (!/^[a-zA-Z0-9/_\-.]+$/.test(branchName)) {
        this.logger.warn(
          `Invalid branch name format: ${branchName}. Skipping sync for ${shardName}.`,
        );
        return;
      }

      this.logger.debug(`Synchronizing shard: ${shardName}`);
      const { stdout } = await execFileAsync(
        "git",
        ["pull", "origin", branchName, "--ff-only"],
        {
          cwd: repoPath,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
          timeout: 60_000,
          maxBuffer: 1024 * 1024 * 10,
        },
      );

      if (stdout.includes("Already up to date.")) {
        this.logger.debug(`[${shardName}] Already up to date.`);
      } else {
        this.logger.log(
          `[${shardName}] New commits pulled — invalidating module cache:\n${stdout}`,
        );
        // Invalidate the module cache so the next pipeline event imports fresh code
        this.applicationLoaderService.invalidateCache(shardName);
      }
    } catch (err) {
      this.logger.warn(
        `[${shardName}] Not a git repository or git pull failed — skipping.`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

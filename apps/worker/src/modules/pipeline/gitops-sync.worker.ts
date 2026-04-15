import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

@Injectable()
export class GitopsSyncWorker {
  private readonly logger = new Logger(GitopsSyncWorker.name);
  private readonly SHARD_BASE_PATH =
    process.env.SHARD_APPLICATION_PATH ||
    path.resolve(process.cwd(), "../../engine/sync/application");
  private readonly DEFAULT_BRANCH = process.env.DEFAULT_BRANCH || "main";

  /**
   * Runs every 5 minutes to synchronize tenant logic shards.
   * This decoupled architecture allows application developers to push PRs,
   * pass standard CI/CD, and be natively picked up by the platform
   * without restarting or rebuilding the core integration monorepo.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async syncShardRepositories() {
    this.logger.log("Starting GitOps Shard Synchronization...");

    try {
      // 1. Ensure the base sync directory exists
      await fs.mkdir(this.SHARD_BASE_PATH, { recursive: true });

      // 2. Discover mapped shard repositories from the central storage registry or configuration.
      // For this phase of the enterprise implementation, we scan the known local directories
      // and perform a git pull to maintain hot-reload parity.
      const entries = await fs.readdir(this.SHARD_BASE_PATH, {
        withFileTypes: true,
      });
      const shardDirs = entries.filter(
        (e) => e.isDirectory() && !e.name.startsWith("."),
      );

      if (shardDirs.length === 0) {
        this.logger.debug(
          "No active sharding directories found for gitops sync.",
        );
        return;
      }

      for (const shard of shardDirs) {
        const repoPath = path.join(this.SHARD_BASE_PATH, shard.name);

        // 3. Verify it is a valid git repository
        try {
          const isRepo = await fs.stat(path.join(repoPath, ".git"));
          if (isRepo.isDirectory() || isRepo.isFile()) {
            this.logger.debug(`Synchronizing Shard: ${shard.name}`);

            // Execute git pull. Because the LogicResolver dynamic import appends a
            // query string cache-buster `?update=timestamp`, Node natively evaluates
            // the new pulled JS without requiring a worker restart!
            const branchName = this.DEFAULT_BRANCH;

            // Validate branch name to prevent command injection
            if (!/^[a-zA-Z0-9/_\-.]+$/.test(branchName)) {
              this.logger.warn(
                `Invalid branch name format: ${branchName}. Skipping sync for ${shard.name}.`,
              );
              continue;
            }

            const { stdout } = await execFileAsync(
              "git",
              ["pull", "origin", branchName, "--ff-only"],
              {
                cwd: repoPath,
                env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
                timeout: 60000, // 60 second timeout
                maxBuffer: 1024 * 1024 * 10, // 10MB buffer
              },
            );

            if (stdout.includes("Already up to date.")) {
              this.logger.debug(`[${shard.name}] Up to date.`);
            } else {
              this.logger.log(
                `[${shard.name}] Successfully synced new logic: \n${stdout}`,
              );
            }
          }
        } catch (err) {
          this.logger.warn(
            `Directory ${shard.name} is not a valid git repository or git operation failed. Skipping sync.`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    } catch (error) {
      this.logger.error("GitOps Shard Synchronization failed", error);
    }
  }
}

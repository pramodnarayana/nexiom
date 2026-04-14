import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { SHARD_APPLICATION_PATH } from "@nexiom/engine";

const execAsync = promisify(exec);

@Injectable()
export class GitopsSyncWorker {
  private readonly logger = new Logger(GitopsSyncWorker.name);
  private readonly SHARD_BASE_PATH = SHARD_APPLICATION_PATH;
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
          if (isRepo.isDirectory()) {
            this.logger.debug(`Synchronizing Shard: ${shard.name}`);

            // Execute git pull. Because the LogicResolver dynamic import appends a
            // query string cache-buster `?update=timestamp`, Node natively evaluates
            // the new pulled JS without requiring a worker restart!
            const branchName = this.DEFAULT_BRANCH;
            const { stdout } = await execAsync(
              `git pull origin ${branchName} --ff-only`,
              { cwd: repoPath },
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
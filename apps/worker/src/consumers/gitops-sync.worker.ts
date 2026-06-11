import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { QueueService, QueueName } from "@soopa/queue";
import { Cron, CronExpression } from "@nestjs/schedule";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { watch } from "node:fs";

import { SyncGitopsShardUseCase } from "../core/use-cases/gitops-sync/sync-gitops-shard.use-case.js";
import { NodeFsGitRepositoryAdapter } from "../adapters/outbound/node-fs-git-repository.adapter.js";
import { NestCacheInvalidatorAdapter } from "../adapters/outbound/nest-cache-invalidator.adapter.js";

@Injectable()
export class GitopsSyncWorker implements OnModuleInit {
  private readonly logger = new Logger(GitopsSyncWorker.name);
  private isSyncRunning = false;

  constructor(
    private readonly queueService: QueueService,
    private readonly gitRepoAdapter: NodeFsGitRepositoryAdapter,
    private readonly cacheInvalidatorAdapter: NestCacheInvalidatorAdapter,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "development") {
      void this.setupLocalFileWatcher();
    }

    this.queueService.consume(QueueName.GitopsQueue, async () => {
      this.logger.log(
        "GitOps webhook event received — triggering immediate sync",
      );

      if (this.isSyncRunning) {
        this.logger.warn(
          "Skipping GitOps sync — previous run still in progress",
        );
        throw new Error(
          "GitOps sync already in progress — message will be retried",
        );
      }

      try {
        await this.runSyncAll();
      } catch (error) {
        this.logger.error("GitOps sync failed via queue message", error);
        throw error;
      }
    });
  }

  private async setupLocalFileWatcher() {
    try {
      const SHARD_BASE_PATH =
        process.env.SHARD_APPLICATION_PATH ||
        path.resolve(process.cwd(), "../../engine/sync/application");

      await fs.mkdir(SHARD_BASE_PATH, { recursive: true });

      this.logger.log(
        `[Local Dev] Starting file watcher on ${SHARD_BASE_PATH} for hot-reloading shards...`,
      );
      watch(SHARD_BASE_PATH, { recursive: true }, (_eventType, filename) => {
        if (!filename || filename.startsWith(".")) return;

        const shardName = filename.split(path.sep)[0];
        if (shardName) {
          // Fire and forget invalidate for local dev
          this.cacheInvalidatorAdapter.invalidate(shardName).catch((err) => {
            this.logger.error(
              `Failed to invalidate cache for ${shardName}`,
              err,
            );
          });
        }
      }).on("error", (err) => {
        this.logger.error("Local file watcher error", err);
      });
    } catch (err) {
      this.logger.error("Failed to setup local file watcher", err);
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async syncShardRepositories() {
    if (this.isSyncRunning) {
      this.logger.warn("Skipping GitOps sync — previous run still in progress");
      return;
    }

    try {
      await this.runSyncAll();
    } catch (error) {
      this.logger.error("GitOps shard synchronization failed", error);
    }
  }

  private async runSyncAll() {
    this.isSyncRunning = true;
    try {
      const useCase = new SyncGitopsShardUseCase(
        this.gitRepoAdapter,
        this.cacheInvalidatorAdapter,
      );
      await useCase.executeAll();
    } finally {
      this.isSyncRunning = false;
    }
  }
}

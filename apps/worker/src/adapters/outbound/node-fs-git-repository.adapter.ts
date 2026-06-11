import { Injectable, Logger } from "@nestjs/common";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  GitRepositoryPort,
  PullResult,
} from "../../core/ports/outbound/gitops-ports.js";

const execFileAsync = promisify(execFile);

@Injectable()
export class NodeFsGitRepositoryAdapter implements GitRepositoryPort {
  private readonly logger = new Logger(NodeFsGitRepositoryAdapter.name);
  private readonly SHARD_BASE_PATH =
    process.env.SHARD_APPLICATION_PATH ||
    path.resolve(process.cwd(), "../../engine/sync/application");
  private readonly DEFAULT_BRANCH = process.env.DEFAULT_BRANCH || "main";

  async listShards(): Promise<string[]> {
    await fs.mkdir(this.SHARD_BASE_PATH, { recursive: true });

    const entries = await fs.readdir(this.SHARD_BASE_PATH, {
      withFileTypes: true,
    });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  }

  async pull(shardName: string): Promise<PullResult> {
    const resolvedBasePath = path.resolve(this.SHARD_BASE_PATH);
    const repoPath = path.resolve(this.SHARD_BASE_PATH, shardName);

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

      const branchName = this.DEFAULT_BRANCH;
      if (!/^[a-zA-Z0-9/_\-.]+$/.test(branchName)) {
        this.logger.warn(
          `Invalid branch name format: ${branchName}. Skipping sync for ${shardName}.`,
        );
        return {
          success: false,
          pulledNewCommits: false,
          output: "Invalid branch name",
        };
      }

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

      return {
        success: true,
        pulledNewCommits: !stdout.includes("Already up to date."),
        output: stdout,
      };
    } catch (err) {
      return {
        success: false,
        pulledNewCommits: false,
        output: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import type { ApplicationShardModule } from '@nexiom/piece-framework';

// ---------------------------------------------------------------------------
// ApplicationLoaderService
//
// Dynamically loads application shard modules from the filesystem using
// Node.js native import(). Caches the loaded module in memory and
// invalidates the cache when the GitopsSyncWorker detects new git commits.
//
// The SHARD_APPLICATION_PATH environment variable controls where shards are
// loaded from. In local development this points to the monorepo directory.
// In production, it points to the checked-out nexiom-integrations repository.
// ---------------------------------------------------------------------------

@Injectable()
export class ApplicationLoaderService {
  private readonly logger = new Logger(ApplicationLoaderService.name);

  private readonly SHARD_BASE_PATH =
    process.env.SHARD_APPLICATION_PATH ??
    path.resolve(process.cwd(), '../../engine/sync/application');

  /** In-memory cache: shardName → loaded module */
  private readonly cache = new Map<string, ApplicationShardModule>();

  /**
   * Loads an application shard module by name.
   *
   * On first call (or after invalidation), dynamically imports the shard's
   * index.js from disk and caches the result. Subsequent calls return the
   * cached module with no filesystem I/O.
   *
   * The ?v=timestamp cache-buster forces Node.js to bypass its internal module
   * registry and re-read from disk after a cache invalidation. Without it,
   * Node.js would return the stale in-process module despite the file changing.
   *
   * IMPORTANT: The caller MUST validate that the shardName is authorized for
   * the tenant before calling this method. This service does not enforce
   * tenant isolation — that is the caller's responsibility.
   */
  async load(shardName: string): Promise<ApplicationShardModule> {
    const cached = this.cache.get(shardName);
    if (cached) return cached;

    const resolvedBase = path.resolve(this.SHARD_BASE_PATH);
    const shardPath = path.resolve(resolvedBase, shardName, 'index.js');

    // Canonicalize paths to prevent symlink-based traversal attacks
    let baseReal: string;
    let shardReal: string;
    try {
      baseReal = await fs.realpath(resolvedBase);
    } catch {
      throw new Error(
        `SHARD_BASE_PATH does not exist or is not accessible: ${resolvedBase}`,
      );
    }

    // Verify the file exists before attempting canonicalization
    try {
      await fs.access(shardPath, fsConstants.F_OK);
    } catch {
      throw new Error(
        `Application shard not found at ${shardPath}. ` +
          `Ensure the shard has been synced via GitOps before the pipeline processes events.`,
      );
    }

    try {
      shardReal = await fs.realpath(shardPath);
    } catch {
      throw new Error(
        `Failed to canonicalize shard path: ${shardPath}`,
      );
    }

    // Path traversal guard: ensure the canonical shard path stays within canonical base
    if (shardReal !== baseReal && !shardReal.startsWith(baseReal + path.sep)) {
      throw new Error(
        `Security violation: shard path escapes trusted boundary — shardName="${shardName}"`,
      );
    }

    this.logger.log(`Loading application shard: ${shardName}`);

    // Dynamic import with timestamp cache-buster so Node.js re-reads from disk
    // after invalidation. The URL query string is ignored at runtime but prevents
    // Node.js from returning the cached module from a previous import() call.
    const mod = (await import(
      `${shardPath}?v=${Date.now()}`
    )) as ApplicationShardModule;

    // Validate exported shape to ensure required functions are present
    const requiredExports = ['extractReplica', 'normalize'];
    const missingExports: string[] = [];

    for (const exportName of requiredExports) {
      if (typeof mod[exportName as keyof ApplicationShardModule] !== 'function') {
        missingExports.push(exportName);
      }
    }

    if (missingExports.length > 0) {
      throw new Error(
        `Invalid shard module at ${shardPath} (shardName="${shardName}"): ` +
          `missing or invalid exports: ${missingExports.join(', ')}. ` +
          `All application shards must export: ${requiredExports.join(', ')}.`,
      );
    }

    this.cache.set(shardName, mod);
    this.logger.log(`Application shard loaded and cached: ${shardName}`);
    return mod;
  }

  /**
   * Invalidates the cached module for a specific shard.
   *
   * Called by GitopsSyncWorker when a git pull detects new commits for the
   * shard. The next pipeline event that calls load(shardName) will re-import
   * the updated module from disk.
   *
   * @param shardName - The name of the shard to invalidate (e.g. "salesforce-revenova")
   */
  invalidateCache(shardName: string): void {
    const existed = this.cache.delete(shardName);
    if (existed) {
      this.logger.log(`Cache invalidated for shard: ${shardName}`);
    }
  }

  /**
   * Invalidates all cached shards. Used on full re-sync or after a
   * platform restart to ensure stale modules are not served.
   */
  invalidateAll(): void {
    this.cache.clear();
    this.logger.log('All shard caches invalidated');
  }
}

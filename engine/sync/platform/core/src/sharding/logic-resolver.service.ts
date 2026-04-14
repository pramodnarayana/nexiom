import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * Executes a dynamically synced first-party custom logic module.
 * 
 * Safely resolves the tenant's logic module from the `engine/sync/application` path.
 * This execution path assumes the module has already been safely synced via 
 * GitOps Shard Synchronization.
 */
@Injectable()
export class LogicResolverService {
  private readonly logger = new Logger(LogicResolverService.name);

  // The base path where shard synchronization pulls all tenant-specific Git shards
  private readonly SHARD_BASE_PATH = path.resolve(process.cwd(), '../../../engine/sync/application');

  /**
   * Resolves a custom transformer module from the application directory and executes it.
   */
  async executeCustomMapping(
    tenantId: string, 
    shardName: string,
    transformFunctionName: string, 
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const safeShardName = path.normalize(shardName).replace(/^(\.\.(\/|\\|$))+/, '');
    const modulePath = path.join(this.SHARD_BASE_PATH, safeShardName, 'index.js');
    
    if (!modulePath.startsWith(this.SHARD_BASE_PATH)) {
      throw new InternalServerErrorException(`Security Violation: Module path escapes trusted boundary.`);
    }

    if (!fs.existsSync(modulePath)) {
        throw new InternalServerErrorException(`Cannot find synced shard module at ${modulePath}`);
    }

    try {
      // Use dynamic import to load the module.
      // To support hot-reloading without process restarts via GitOps sync (T054),
      // we append a dynamically uncacheable query string.
      const bustCache = `?update=${Date.now()}`;
      const customModule = await import(`${modulePath}${bustCache}`);
      
      const fn = customModule[transformFunctionName];
      if (typeof fn !== 'function') {
        throw new Error(`Function ${transformFunctionName} is not exported from the synced shard module ${safeShardName}`);
      }

      this.logger.debug(`Executing custom logic ${transformFunctionName} for tenant ${tenantId} via shard ${safeShardName}`);
      // Execute securely natively 
      const result = await fn(payload);
      return result as Record<string, unknown>;
    } catch (error) {
      this.logger.error(`Failed to execute custom logic in shard ${safeShardName}`, error);
      throw new InternalServerErrorException(`Custom mapping execution failed for shard ${safeShardName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

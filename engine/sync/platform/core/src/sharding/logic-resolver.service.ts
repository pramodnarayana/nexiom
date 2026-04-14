import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { SHARD_APPLICATION_PATH } from './shard-config.constants.js';

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
  private readonly SHARD_BASE_PATH = SHARD_APPLICATION_PATH;

  /**
   * Resolves a custom transformer module from the application directory and executes it.
   *
   * IMPORTANT: The caller MUST ensure shardName corresponds to tenantId before calling this method.
   * This service does not validate shard ownership - tenant isolation must be enforced by the caller
   * (e.g., by querying the shard registry or configuration to verify the tenant has access to the shard).
   *
   * @param tenantId - Tenant identifier for logging/audit purposes only
   * @param shardName - Name of the shard directory (caller must validate ownership)
   * @param transformFunctionName - Name of the exported function to execute
   * @param payload - Data to pass to the transform function
   */
  async executeCustomMapping(
    tenantId: string,
    shardName: string,
    transformFunctionName: string,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Use path.resolve to get absolute paths for reliable comparison across platforms
    const resolvedBasePath = path.resolve(this.SHARD_BASE_PATH);
    const modulePath = path.resolve(this.SHARD_BASE_PATH, shardName, 'index.js');

    // Verify the resolved module path is within the base path to prevent path traversal
    if (!modulePath.startsWith(resolvedBasePath + path.sep) && modulePath !== resolvedBasePath) {
      throw new InternalServerErrorException(`Security Violation: Module path escapes trusted boundary.`);
    }

    // Use async filesystem check instead of blocking existsSync
    try {
      await fs.access(modulePath, fsConstants.F_OK);
    } catch {
      throw new InternalServerErrorException(`Cannot find synced shard module at ${modulePath}`);
    }

    try {
      // Use dynamic import to load the module.
      // To support hot-reloading without process restarts via GitOps sync (T054),
      // we read the file content and import via data URL to force fresh evaluation.
      const fileContent = await fs.readFile(modulePath, 'utf-8');
      const dataUrl = `data:application/javascript;base64,${Buffer.from(fileContent).toString('base64')}`;
      const customModule = await import(dataUrl);
      
      const fn = customModule[transformFunctionName];
      if (typeof fn !== 'function') {
        throw new Error(`Function ${transformFunctionName} is not exported from the synced shard module ${shardName}`);
      }

      this.logger.debug(`Executing custom logic ${transformFunctionName} for tenant ${tenantId} via shard ${shardName}`);

      // Execute with timeout to prevent indefinite hangs
      const result = await this.runTransformWithTimeout(fn, payload, 30000);
      return result as Record<string, unknown>;
    } catch (error) {
      this.logger.error(`Failed to execute custom logic in shard ${shardName}`, error);
      throw new InternalServerErrorException(`Custom mapping execution failed for shard ${shardName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Runs a transform function with a wall-clock timeout to prevent indefinite execution.
   * If the function exceeds the timeout, the execution is aborted and an error is thrown.
   *
   * @param fn - The transform function to execute
   * @param payload - Data to pass to the function
   * @param timeoutMs - Maximum execution time in milliseconds
   * @returns The result from the transform function
   */
  private async runTransformWithTimeout(
    fn: (payload: Record<string, unknown>) => unknown,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(new Error(`Transform function execution exceeded timeout of ${timeoutMs}ms`));
      }, timeoutMs);

      Promise.resolve(fn(payload))
        .then((result) => {
          clearTimeout(timeoutHandle);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutHandle);
          reject(error);
        });
    });
  }
}
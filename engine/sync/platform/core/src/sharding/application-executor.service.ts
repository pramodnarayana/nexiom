import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import * as esbuild from 'esbuild';
import { getQuickJS } from 'quickjs-emscripten';
const SHARD_APPLICATION_PATH = process.env.SHARD_APPLICATION_PATH || path.resolve(process.cwd(), '../../engine/sync/application');

/**
 * Executes a dynamically synced first-party custom logic module.
 *
 * Safely resolves the tenant's logic module from the `engine/sync/application` path.
 * This execution path assumes the module has already been safely synced via
 * GitOps Shard Synchronization.
 */
@Injectable()
export class ApplicationExecutorService {
  private readonly logger = new Logger(ApplicationExecutorService.name);

  // The base path where shard synchronization pulls all tenant-specific Git shards
  private readonly SHARD_BASE_PATH = SHARD_APPLICATION_PATH;

  // Cache for bundled JS code to avoid recompiling on every invocation
  private esbuildCache = new Map<string, string>();

  /**
   * Invalidates the bundled cache for a specific shard. 
   * Intended to be called by the GitOps worker upon detecting a new commit.
   */
  invalidateCache(shardName: string) {
    this.esbuildCache.delete(shardName);
  }

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
      let code = this.esbuildCache.get(shardName);
      
      // 1. Bundle the application logic (includes jsonata/libraries)
      if (!code) {
        this.logger.debug(`Bundling application shard: ${shardName}`);
        const buildResult = await esbuild.build({
          entryPoints: [modulePath],
          bundle: true,
          write: false,
          format: 'iife',
          globalName: 'CustomLogic',
          platform: 'browser', // Prevent native Node.js requires
        });
        code = buildResult.outputFiles[0].text;
        this.esbuildCache.set(shardName, code);
      }

      this.logger.debug(`Executing custom logic ${transformFunctionName} for tenant ${tenantId} via shard ${shardName} in WebAssembly Sandbox`);

      // 2. Initialize QuickJS WebAssembly Sandbox
      const QuickJS = await getQuickJS();
      const vm = QuickJS.newContext();

      // Hard memory limit: 128MB per execution
      vm.runtime.setMemoryLimit(128 * 1024 * 1024);

      // Set interrupt handler with deadline (30 second timeout)
      const TIMEOUT_MS = 30_000;
      const deadline = Date.now() + TIMEOUT_MS;
      const shouldInterruptAfterDeadline = () => {
        return Date.now() > deadline;
      };
      vm.runtime.setInterruptHandler(shouldInterruptAfterDeadline);

      try {
        // 3. Pass data securely across the boundary
        const payloadStr = JSON.stringify(payload);
        const payloadHandle = vm.newString(payloadStr);
        vm.setProp(vm.global, 'payloadStr', payloadHandle);
        payloadHandle.dispose();

        const funcNameHandle = vm.newString(transformFunctionName);
        vm.setProp(vm.global, 'funcName', funcNameHandle);
        funcNameHandle.dispose();

        // 4. Compile execution wrapper that produces a guest Promise
        const scriptCode = `
          var __sandbox_result = null;
          var __sandbox_error = null;
          var __sandbox_promise = (async () => {
            try {
              ${code}
              const fn = CustomLogic[funcName];
              if (typeof fn !== 'function') throw new Error('Function ' + funcName + ' is not exported from the synced shard module');
              const result = await fn(JSON.parse(payloadStr));
              __sandbox_result = JSON.stringify(result);
            } catch (e) {
              __sandbox_error = e.message || String(e);
            }
          })();
        `;

        // 5. Execute Code
        const evalResult = vm.evalCode(scriptCode);
        if (evalResult.error) {
          const errDump = vm.dump(evalResult.error);
          evalResult.error.dispose();
          throw new Error(errDump.message || "Unknown Sandbox Evaluation Error");
        }
        evalResult.value.dispose();

        // Check if deadline has elapsed before executing pending jobs
        if (Date.now() > deadline) {
          throw new Error(`Execution timeout: exceeded ${TIMEOUT_MS}ms deadline before async completion`);
        }

        // Flush the Promise Microtask Queue
        vm.runtime.executePendingJobs();

        // Check again after job execution
        if (Date.now() > deadline) {
          throw new Error(`Execution timeout: exceeded ${TIMEOUT_MS}ms deadline during async execution`);
        }

        // Extract result or error from the global context
        const errorHandle = vm.getProp(vm.global, '__sandbox_error');
        const isErrorNull = vm.dump(errorHandle) === null;
        if (!isErrorNull) {
          const errStr = vm.getString(errorHandle);
          errorHandle.dispose();
          throw new Error(errStr);
        }
        errorHandle.dispose();

        const resultHandle = vm.getProp(vm.global, '__sandbox_result');
        const resultStr = vm.getString(resultHandle);
        resultHandle.dispose();

        // Parse and validate return type
        const parsed = JSON.parse(resultStr);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error(
            `Invalid shard mapping return: expected Record<string, unknown>, got ${
              parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed
            }`
          );
        }

        return parsed as Record<string, unknown>;
      } finally {
        vm.dispose();
      }
    } catch (error) {
      this.logger.error(`Failed to execute custom logic in shard ${shardName}`, error);
      throw new InternalServerErrorException(`Custom mapping execution failed for shard ${shardName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
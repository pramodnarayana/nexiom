import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createRequire } from 'module';
import * as path from 'path';
import * as url from 'url';

// ─── Worker Pool interface ─────────────────────────────────────────────────────
// Piscina uses `export =` CJS syntax which TypeScript's nodenext resolution
// cannot use as a type annotation directly (TS2709).  We declare the minimal
// interface we actually depend on so that:
//   a) No `any` leaks into production code.
//   b) We are only coupled to the methods we use, not the entire Piscina API.
//   c) Alternative pool implementations (e.g. in tests) can satisfy this type.

interface WorkerPool {
  run(input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  destroy(): Promise<void>;
}

interface WorkerPoolConstructor {
  new (options: {
    filename: string;
    minThreads?: number;
    maxThreads?: number;
    idleTimeout?: number;
  }): WorkerPool;
}

/**
 * Manages execution of dynamically downloaded piece code inside Node.js Worker Threads
 * using a high-performance pre-warmed Piscina worker pool.
 *
 * Each trigger invocation runs in an isolated V8 thread so that:
 *   a) Slow or blocking integration code never stalls the main event loop.
 *   b) A crashed worker thread is automatically replaced by Piscina.
 *   c) Each Piscina thread's require.cache is keyed by the real (resolved) path,
 *      so atomically swapping the stable symlink in PluginManagerService is
 *      sufficient to bust the cache — no thread restart required.
 */
@Injectable()
export class ExecutionWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExecutionWorkerService.name);
  private pool!: WorkerPool;

  onModuleInit(): void {
    this.logger.log('Initializing Piscina Worker Pool...');

    const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
    const workerScript = path.join(__dirname, 'piece-execution.worker.js');

    // Load Piscina via createRequire to handle its CJS `export =` pattern
    // without requiring `any` or a blanket type cast.
    const PiscinaConstructor = createRequire(import.meta.url)(
      'piscina',
    ) as WorkerPoolConstructor;

    this.pool = new PiscinaConstructor({
      filename: workerScript,
      minThreads: 2,   // Pre-warm 2 threads for zero-latency cold starts
      maxThreads: 8,   // Scale under load
      idleTimeout: 60_000, // Retire scaled threads after 1 min of inactivity
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Draining Piscina Worker Pool...');
    if (this.pool) {
      await this.pool.destroy();
    }
  }

  /**
   * Executes a trigger function from a piece safely in a background worker thread.
   *
   * @param scriptPath  Physical (or symlink) path to the installed plugin bundle.
   *                    Node.js resolves symlinks to their real path before caching,
   *                    so hot-swapping the symlink automatically routes new tasks
   *                    to the new version without restarting any threads.
   * @param triggerName Name of the trigger to execute.
   * @param payload     Webhook payload forwarded to the trigger's run() function.
   */
  async executeTrigger(
    scriptPath: string,
    triggerName: string,
    payload: unknown,
  ): Promise<unknown> {
    this.logger.debug(`Dispatching ${triggerName} to Worker Pool`);

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      this.logger.warn(
        `Execution timeout reached for ${scriptPath}. Aborting worker thread.`,
      );
      abortController.abort();
    }, 30_000);

    try {
      return await this.pool.run(
        { scriptPath, triggerName, payload },
        { signal: abortController.signal },
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Worker execution failed for ${scriptPath}: ${msg}`);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

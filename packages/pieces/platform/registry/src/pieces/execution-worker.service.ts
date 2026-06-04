import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Piscina from 'piscina';
import * as path from 'path';
import * as url from 'url';

/**
 * Manages execution of dynamically downloaded piece code inside Node.js Worker Threads
 * using a high-performance pre-warmed worker pool.
 */
@Injectable()
export class ExecutionWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExecutionWorkerService.name);
  private pool!: any;

  onModuleInit() {
    this.logger.log('Initializing Piscina Worker Pool...');
    
    // Resolve the path to the compiled worker script.
    // Piscina requires a physical file path to spawn threads.
    const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
    const workerScript = path.join(__dirname, 'piece-execution.worker.js');

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
    this.pool = new (Piscina as any)({
      filename: workerScript,
      minThreads: 2, // Pre-warm 2 threads immediately for zero-latency boots
      maxThreads: 8, // Scale up to 8 threads under load
      idleTimeout: 60000, // Terminate scaled threads after 1 min of inactivity
    });
  }

  async onModuleDestroy() {
    this.logger.log('Draining Piscina Worker Pool...');
    await this.pool.destroy();
  }

  /**
   * Executes a trigger function from a piece safely in a background worker thread.
   * @param scriptPath The physical path to the installed plugin bundle on disk
   * @param triggerName The name of the trigger to execute
   * @param payload The webhook payload data
   */
  async executeTrigger(scriptPath: string, triggerName: string, payload: any): Promise<any> {
    this.logger.debug(`Dispatching ${triggerName} to Worker Pool`);

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      this.logger.warn(`Execution timeout reached for ${scriptPath}. Aborting worker thread.`);
      abortController.abort();
    }, 30000); // 30-second strict execution limit

    try {
      // Execute the function in an available worker thread.
      // This is near-instant because the V8 Isolates are already booted.
      const result = await this.pool.run(
        { scriptPath, triggerName, payload },
        { signal: abortController.signal }
      );
      return result;
    } catch (error: any) {
      this.logger.error(`Worker execution failed for ${scriptPath}: ${error.message}`);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

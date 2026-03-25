import { Injectable, Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';

/** Hard drain timeout before force-exiting the process. */
// Set below Kubernetes terminationGracePeriodSeconds (default 30s)
// to allow process.exit(0) before sending SIGKILL (137).
const DRAIN_TIMEOUT_MS = 25_000;

/**
 * ShutdownService -- graceful SIGTERM/SIGINT drain.
 *
 * Registers OS signal handlers that call app.close(), which triggers
 * OnModuleDestroy hooks on all providers (including QueueService.stopConsuming()).
 * A hard 25-second deadline force-exits the process if drain stalls.
 *
 * Call enableShutdownHooks(app) immediately after app.listen() in main.ts.
 */
@Injectable()
export class ShutdownService {
  private readonly logger = new Logger(ShutdownService.name);
  /** Prevents re-entrant shutdown if multiple signals arrive while draining. */
  private shuttingDown = false;
  /** Prevents duplicate listener registration if enableShutdownHooks is called more than once. */
  private shutdownHooksEnabled = false;

  enableShutdownHooks(app: INestApplication): void {
    if (this.shutdownHooksEnabled) {
      this.logger.warn(
        'Shutdown hooks already registered — ignoring duplicate call',
      );
      return;
    }
    this.shutdownHooksEnabled = true;
    // process.once ensures each signal fires the handler at most once, even if
    // the OS delivers duplicates before the first handler finishes executing.
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(signal, () => void this.shutdown(app, signal));
    }
    this.logger.log('Graceful shutdown hooks registered (SIGTERM, SIGINT)');
  }

  private async shutdown(app: INestApplication, signal: string): Promise<void> {
    if (this.shuttingDown) {
      this.logger.log(
        `Already shutting down — ignoring duplicate signal ${signal}`,
      );
      return;
    }
    this.shuttingDown = true;

    this.logger.log(
      `Received ${signal} -- draining in-flight work (timeout ${DRAIN_TIMEOUT_MS / 1_000}s)`,
    );

    // Hard deadline -- force-exits if drain takes too long.
    const deadline = setTimeout(() => {
      this.logger.error(
        `Drain deadline exceeded (${DRAIN_TIMEOUT_MS / 1_000}s) -- forcing exit`,
      );
      process.exit(1);
    }, DRAIN_TIMEOUT_MS);
    // Allow the event loop to exit naturally if everything else closes first.
    deadline.unref();

    try {
      // app.close() triggers OnModuleDestroy on all providers.
      // QueueService.stopConsuming() drains SQS consumers here.
      await app.close();
      clearTimeout(deadline);
      this.logger.log('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      clearTimeout(deadline);
      this.logger.error(
        'Error during graceful shutdown -- forcing exit',
        err instanceof Error ? (err.stack ?? err.message) : String(err),
      );
      process.exit(1);
    }
  }
}

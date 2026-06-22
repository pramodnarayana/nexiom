import { Injectable, Logger, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PUB_SUB_CLIENT, type IPubSub } from '@soopa/cache';
import { QUEUE_SERVICE, QueueName } from '@soopa/queue';
import type { IQueueService } from '@soopa/queue';
import { PluginManagerService } from './plugin-manager.service.js';
import { PieceRegistryService } from './piece-registry.service.js';
import type { Piece } from '@soopa/piece-framework';

// ─── Pure piece-extraction helpers ───────────────────────────────────────────
// Exported so InstallPieceUseCase (and any future consumer) can share the same
// validated extraction logic — no duplication, no divergence.

/**
 * Returns true when `value` satisfies the minimal structural contract of a
 * Piece object.  Kept intentionally permissive (only required fields) so that
 * pieces with optional fields are never silently rejected.
 */
export function isPieceShape(value: unknown): value is Piece {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['name'] === 'string' &&
    typeof v['displayName'] === 'string' &&
    typeof v['auth'] === 'object' &&
    v['auth'] !== null &&
    Array.isArray(v['categories'])
  );
}

/**
 * Walks a module exports object and returns the first value that satisfies
 * the Piece shape contract.  Supports three export conventions:
 *
 *   1. `export.register()` → factory pattern
 *   2. `export.default.register()` → factory on default export
 *   3. Any direct export that is a Piece
 *
 * Returns `null` when no valid Piece is found, so callers can decide how to
 * handle the absence without catching an exception.
 */
export function extractPieceFromModule(
  mod: Record<string, unknown>,
): Piece | null {
  // Try register() factory patterns first
  let registerFn = mod['register'];
  if (
    typeof registerFn !== 'function' &&
    mod['default'] !== undefined &&
    typeof (mod['default'] as Record<string, unknown>)['register'] === 'function'
  ) {
    registerFn = (mod['default'] as Record<string, unknown>)['register'];
  }

  if (typeof registerFn === 'function') {
    const candidate: unknown = (registerFn as () => unknown)();
    if (isPieceShape(candidate)) return candidate;
  }

  // Fall back to scanning all exports
  for (const exported of Object.values(mod)) {
    if (isPieceShape(exported)) return exported;
  }

  return null;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class PluginHotReloaderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PluginHotReloaderService.name);

  private readonly channel = 'system:plugins:reloaded';

  /**
   * Per-package serial execution queue.
   *
   * Redis may deliver multiple messages for the same package in rapid
   * succession (e.g. two force-publishes in a row).  Without serialisation
   * the async handlers would interleave:
   *   installPiece(v1) → installPiece(v2) → requirePiece(v1) → requirePiece(v2)
   * producing a non-deterministic registry state.
   *
   * We chain promises per package-name so each hot-reload for a given package
   * completes fully before the next one starts.  Different packages run
   * concurrently — no global serialisation bottleneck.
   */
  private readonly installQueues = new Map<string, Promise<void>>();

  constructor(
    @Inject(PUB_SUB_CLIENT) private readonly pubsub: IPubSub,
    @Inject(QUEUE_SERVICE) private readonly queueService: IQueueService,
    private readonly pluginManager: PluginManagerService,
    private readonly pieceRegistry: PieceRegistryService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.pubsub.onMessage((channel: string, message: string) => {
      if (channel !== this.channel) return;

      let payload: { packageName?: unknown; version?: unknown };
      try {
        payload = JSON.parse(message) as typeof payload;
      } catch {
        this.logger.error(`Received malformed hot-reload message (not valid JSON)`);
        return;
      }

      if (
        typeof payload.packageName !== 'string' ||
        typeof payload.version !== 'string'
      ) {
        this.logger.warn(
          `Skipping hot-reload message — missing packageName or version fields`,
        );
        return;
      }

      const { packageName, version } = payload;
      this.logger.log(`Received hot-reload event for ${packageName}@${version}`);

      // Enqueue — chain onto the existing tail so this package's installs
      // execute serially while other packages remain unblocked.
      const previous = this.installQueues.get(packageName) ?? Promise.resolve();
      const next = previous.then(() => this.hotLoadPiece(packageName, version));
      this.installQueues.set(packageName, next);

      // Clean up the queue entry after the promise settles to prevent memory leaks
      next.finally(() => {
        if (this.installQueues.get(packageName) === next) {
          this.installQueues.delete(packageName);
        }
      });

      // Prevent unhandled-rejection — hotLoadPiece already logs and swallows errors.
      next.catch(() => {});
    });

    try {
      await this.pubsub.subscribe(this.channel);
      this.logger.log(`Subscribed to channel "${this.channel}" for hot-reloading.`);
    } catch (error: unknown) {
      this.logger.error(`Failed to subscribe to "${this.channel}": ${String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    // RedisPubSubService handles quit automatically if it's a global provider,
    // but we can call it explicitly if needed. Not strictly necessary since we inject
    // a shared global pub/sub client, but good practice if it's dedicated.
    // However, if PUB_SUB_CLIENT is global, we shouldn't quit it here as other modules
    // might be using it. Assuming the module handles lifecycle.
  }

  private async hotLoadPiece(packageName: string, version: string): Promise<void> {
    try {
      const { moduleExports, version: resolvedVersion } = await this.pluginManager.ensurePiece(packageName, version);
      const piece = extractPieceFromModule(moduleExports);

      if (!piece) {
        this.logger.warn(
          `${packageName} is not a Piece (missing name/displayName/auth/categories). ` +
            `It may be a domain library — skipping registry update.`,
        );
        return;
      }

      this.pieceRegistry.registerPiece(piece);
      this.logger.log(`Hot-reloaded piece: ${piece.name} (${packageName}@${resolvedVersion})`);

      if (piece.migrationsFolder) {
        const info = this.pluginManager.getPieceInfo(packageName);
        if (info) {
          this.logger.log(`Enqueuing migrations for ${piece.name}`);
          await this.queueService.send(QueueName.TenantProvisionQueue, {
            pluginLocation: info.location,
            pieceName: piece.name,
            migrationsFolder: piece.migrationsFolder,
          });
        }
      }
    } catch (error: unknown) {
      this.logger.error(
        `Failed to hot-load ${packageName}@${version}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

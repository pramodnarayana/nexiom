import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { PluginManager } from 'live-plugin-manager';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { QUEUE_SERVICE, QueueName } from '@soopa/queue';
import type { IQueueService, PluginMigrationEvent } from '@soopa/queue';

@Injectable()
export class PluginManagerService implements OnModuleInit {
  private readonly logger = new Logger(PluginManagerService.name);
  private manager: PluginManager;
  private readonly pluginsPath: string;
  public static readonly PLUGINS_PATH = (() => {
    const isDev = process.env.NODE_ENV === 'development' || process.env.DEV_MODE === 'true';
    const appDataDir = process.env.APP_DATA_DIR || (isDev ? process.cwd() : path.join(os.homedir(), '.soopa'));
    return process.env.PLUGINS_PATH || (isDev ? path.join(os.tmpdir(), 'soopa-plugins') : path.join(appDataDir, 'plugins'));
  })();

  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: IQueueService
  ) {
    this.pluginsPath = PluginManagerService.PLUGINS_PATH;
    this.logger.log(`Initializing Live Plugin Manager at: ${this.pluginsPath}`);

    this.manager = new PluginManager({
      pluginsPath: this.pluginsPath,
      npmRegistryUrl: process.env.NPM_REGISTRY_URL || 'https://registry.npmjs.org/'
    });
  }

  async onModuleInit() {
    try {
      try {
        await fs.promises.access(this.pluginsPath);
        // Apply restrictive permissions to existing directory
        await fs.promises.chmod(this.pluginsPath, 0o700);
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          await fs.promises.mkdir(this.pluginsPath, { recursive: true, mode: 0o700 });
          this.logger.log(`Created plugins directory with restricted permissions (700): ${this.pluginsPath}`);
        } else {
          throw err;
        }
      }
    } catch (error) {
      this.logger.error(`Failed to initialize plugins directory at ${this.pluginsPath}`, error);
      throw error;
    }
  }

  /**
   * Downloads and installs a piece from the NPM registry.
   * @param packageName The name of the piece (e.g. '@soopa/piece-revenova')
   * @param version The specific version to install, or 'latest'
   */
  async installPiece(packageName: string, version: string = 'latest'): Promise<any> {
    this.logger.log(`Downloading piece: ${packageName}@${version}...`);
    try {
      const pluginInfo = await this.manager.install(packageName, version);
      this.logger.log(`Successfully installed ${packageName}@${pluginInfo.version} to ${pluginInfo.location}`);

      // Dispatch migration job to SQS queue for guaranteed execution
      // Only dispatch if tenant handlers are available
      if (process.env.ENABLE_PLUGIN_MIGRATIONS === 'true') {
        const migrationEvent: PluginMigrationEvent = {
          pluginLocation: pluginInfo.location,
          pieceName: packageName
        };

        try {
          await this.queueService.send(QueueName.TenantProvisionQueue, migrationEvent);
          this.logger.log(`Dispatched migration job for ${packageName} to SQS`);
        } catch (queueError) {
          this.logger.error(`Failed to dispatch migration job for ${packageName}. Rolling back installation...`, queueError);
          await this.manager.uninstall(packageName);
          throw queueError;
        }
      } else {
        this.logger.debug(
          `Skipping migration dispatch for ${packageName} (ENABLE_PLUGIN_MIGRATIONS not set)`
        );
      }

      return pluginInfo;
    } catch (error) {
      this.logger.error(`Failed to install piece ${packageName}@${version}`, error);
      throw error;
    }
  }

  /**
   * Retrieves information about an installed piece, including its physical disk location.
   */
  getPieceInfo(packageName: string) {
    return this.manager.getInfo(packageName);
  }

  /**
   * Ensures a piece is installed on disk without re-triggering a migration if it already exists.
   * Useful for Startup Synchronization.
   */
  async ensurePiece(packageName: string, version: string = 'latest'): Promise<any> {
    const existing = this.getPieceInfo(packageName);
    if (existing) {
      this.logger.debug(`Piece ${packageName} already exists on disk. Skipping download.`);
      return existing;
    }
    
    this.logger.log(`Startup Sync: Downloading missing piece ${packageName}...`);
    // Delegate to installPiece so that migrations and publishing flow are triggered
    const pluginInfo = await this.installPiece(packageName, version);
    this.logger.log(`Startup Sync: Installed ${packageName} to ${pluginInfo.location}`);
    return pluginInfo;
  }

  /**
   * Dynamically requires the piece code (for trusted internal execution).
   * Note: In a true zero-downtime architecture, this is passed to a Worker Thread instead.
   */
  requirePiece(packageName: string) {
    return this.manager.require(packageName);
  }
}

import { Injectable, Logger, Inject } from '@nestjs/common';
import { PluginManager } from 'live-plugin-manager';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { QUEUE_SERVICE, QueueName } from '@soopa/queue';
import type { IQueueService, PluginMigrationEvent } from '@soopa/queue';

@Injectable()
export class PluginManagerService {
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
    // Determine plugins path based on environment
    const isDev = process.env.NODE_ENV === 'development' || process.env.DEV_MODE === 'true';
    const appDataDir = process.env.APP_DATA_DIR || (isDev ? process.cwd() : path.join(os.homedir(), '.soopa'));

    // Default to app-owned persistent directory, only use tmpdir in development
    this.pluginsPath = process.env.PLUGINS_PATH ||
      (isDev ? path.join(os.tmpdir(), 'soopa-plugins') : path.join(appDataDir, 'plugins'));

    this.logger.log(`Initializing Live Plugin Manager at: ${this.pluginsPath}`);

    // Ensure the directory exists with restrictive permissions
    if (!fs.existsSync(this.pluginsPath)) {
      fs.mkdirSync(this.pluginsPath, { recursive: true, mode: 0o700 });
      this.logger.log(`Created plugins directory with restricted permissions (700): ${this.pluginsPath}`);
    } else {
      // Apply restrictive permissions to existing directory
      fs.chmodSync(this.pluginsPath, 0o700);
    }

    this.manager = new PluginManager({
      pluginsPath: this.pluginsPath,
      npmRegistryUrl: process.env.NPM_REGISTRY_URL || 'https://registry.npmjs.org/'
    });
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
      const migrationEvent: PluginMigrationEvent = {
        pluginLocation: pluginInfo.location,
        pieceName: packageName
      };
      
      await this.queueService.send(QueueName.TenantProvisionQueue, migrationEvent);
      this.logger.log(`Dispatched migration job for ${packageName} to SQS`);

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
    const pluginInfo = await this.manager.install(packageName, version);
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

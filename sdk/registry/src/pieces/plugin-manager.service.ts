import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { PluginManager, IPluginInfo } from 'live-plugin-manager';
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
    @Inject(QUEUE_SERVICE) private readonly queueService: IQueueService,
  ) {
    this.pluginsPath = PluginManagerService.PLUGINS_PATH;
    this.logger.log(`Initializing Live Plugin Manager at: ${this.pluginsPath}`);

    this.manager = new PluginManager({
      pluginsPath: this.pluginsPath,
      npmRegistryUrl: process.env.NPM_REGISTRY_URL || 'https://registry.npmjs.org/'
    });
  }

  private initPromise: Promise<void> | null = null;

  async onModuleInit() {
    // No-op. NestJS triggers this, but we explicitly await initializePlugins() earlier in the PIECES_FACTORY_PROVIDER.
  }

  async initializePlugins(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        try {
          await fs.promises.access(this.pluginsPath);
          await fs.promises.chmod(this.pluginsPath, 0o700);
        } catch (err: unknown) {
          if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            await fs.promises.mkdir(this.pluginsPath, { recursive: true, mode: 0o700 });
            this.logger.log(`Created plugins directory with restricted permissions (700): ${this.pluginsPath}`);
          } else {
            throw err;
          }
        }

      } catch (error) {
        this.logger.error(`Failed to initialize plugins directory at ${this.pluginsPath}`, error);
        this.initPromise = null;
        throw error;
      }
    })();

    await this.initPromise;
  }

  /**
   * Downloads and installs a piece from the NPM registry.
   * @param packageName The name of the piece (e.g. '@soopa/piece-revenova')
   * @param version The specific version to install, or 'latest'
   */
  async installPiece(packageName: string, version: string = 'latest'): Promise<IPluginInfo> {
    this.logger.log(`Downloading piece: ${packageName}@${version}...`);
    try {
      const pluginInfo = await this.manager.install(packageName, version);
      this.logger.log(`Successfully installed ${packageName}@${pluginInfo.version} to ${pluginInfo.location}`);
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

  async ensurePiece(packageName: string, version: string = 'latest'): Promise<IPluginInfo> {
    const existing = this.getPieceInfo(packageName);
    if (existing) {
      this.logger.debug(`Piece ${packageName} already exists on disk. Skipping download.`);
      return existing;
    }

    this.logger.log(`Ensuring piece ${packageName} from NPM registry...`);
    const pluginInfo = await this.installPiece(packageName, version);
    this.logger.log(`Installed ${packageName} to ${pluginInfo.location}`);
    return pluginInfo;
  }

  async requirePiece(packageName: string): Promise<Record<string, unknown>> {
    const pluginInfo = this.getPieceInfo(packageName);
    if (!pluginInfo) {
      throw new Error(`Piece ${packageName} is not installed`);
    }

    try {
      const mainFile = pluginInfo.mainFile || 'dist/index.js';
      const modulePath = path.resolve(pluginInfo.location, mainFile);
      return await import(`file://${modulePath}`);
    } catch (importErr) {
      this.logger.error(`Failed to dynamically load ESM piece package ${packageName}`, importErr);
      return this.manager.require(packageName) as Record<string, unknown>;
    }
  }
}

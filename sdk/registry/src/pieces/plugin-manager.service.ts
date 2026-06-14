import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PluginManager, IPluginInfo } from 'live-plugin-manager';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
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
    private readonly configService: ConfigService,
  ) {
    const isDev = this.configService.get<string>('NODE_ENV') === 'development' || this.configService.get<string>('DEV_MODE') === 'true';
    const appDataDir = this.configService.get<string>('APP_DATA_DIR') || (isDev ? process.cwd() : path.join(os.homedir(), '.soopa'));
    this.pluginsPath = this.configService.get<string>('PLUGINS_PATH') || (isDev ? path.join(os.tmpdir(), 'soopa-plugins') : path.join(appDataDir, 'plugins'));

    const registryUrl = this.configService.get<string>('NPM_REGISTRY_URL') || process.env.NPM_REGISTRY_URL || 'https://registry.npmjs.org/';
    this.logger.log(`Initializing Live Plugin Manager at: ${this.pluginsPath}`);
    this.logger.log(`Using NPM registry: ${registryUrl}`);

    const hostReq = createRequire(import.meta.url);
    const fw = hostReq('@soopa/piece-framework');
    const spreadFw = { ...fw };
    this.logger.debug(`[DEBUG] hostReq('@soopa/piece-framework') keys: ${Object.keys(fw)}`);
    this.logger.debug(`[DEBUG] fw.createCustomApiCallAction exists? ${!!fw.createCustomApiCallAction}`);
    this.logger.debug(`[DEBUG] spreadFw keys: ${Object.keys(spreadFw)}`);
    this.logger.debug(`[DEBUG] spreadFw.createCustomApiCallAction exists? ${!!spreadFw.createCustomApiCallAction}`);

    this.manager = new PluginManager({
      pluginsPath: this.pluginsPath,
      npmRegistryUrl: registryUrl,
      // Platform packages are injected at runtime via IoC — never install them as transitive deps
      ignoredDependencies: [
        '@soopa/piece-framework',
        '@soopa/domain-tms',
      ],
      staticDependencies: {
        '@soopa/piece-framework': { ...hostReq('@soopa/piece-framework') },
        '@soopa/piece-framework/discovery': { ...hostReq('@soopa/piece-framework/discovery') },
        '@soopa/domain-tms': { ...hostReq('@soopa/domain-tms') },
      },
      hostRequire: hostReq,
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
   * Downloads and installs a piece from the NPM registry or local path.
   * @param packageName The name of the piece (e.g. '@soopa/piece-revenova')
   * @param version The specific version to install, or 'latest'. Can also be a local path 'file:/...'
   */
  async installPiece(packageName: string, version: string = 'latest'): Promise<IPluginInfo> {
    const registryUrl = this.configService.get<string>('NPM_REGISTRY_URL') || process.env.NPM_REGISTRY_URL || 'https://registry.npmjs.org/';
    this.logger.log(`Downloading piece: ${packageName}@${version} from registry: ${registryUrl}`);
    try {
      const pluginInfo = await this.manager.install(packageName, version);
      
      this.logger.log(`Successfully installed ${packageName}@${pluginInfo.version} to ${pluginInfo.location}`);
      return pluginInfo;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : '';
      this.logger.error(
        `Failed to install piece ${packageName}@${version} from ${registryUrl} — ${message}`,
      );
      if (stack) this.logger.debug(stack);
      throw error;
    }
  }

  private localFilePlugins = new Map<string, IPluginInfo>();

  /**
   * Retrieves information about an installed piece, including its physical disk location.
   */
  getPieceInfo(packageName: string) {
    if (this.localFilePlugins.has(packageName)) {
      return this.localFilePlugins.get(packageName);
    }
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
      // live-plugin-manager executes the plugin in a custom CommonJS context
      // and natively intercepts `require('@soopa/piece-framework')` to map it to our hostRequire
      const moduleExports = this.manager.require(packageName) as Record<string, unknown>;

      // Verify the piece loaded successfully
      if (!moduleExports || typeof moduleExports !== 'object') {
        throw new Error(`Piece ${packageName} loaded but did not export a valid module object`);
      }

      this.logger.debug(`Successfully loaded piece ${packageName} from ${pluginInfo.location}`);
      return moduleExports;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : '';
      this.logger.error(
        `Failed to load piece package ${packageName} via CommonJS interception — ${reason}. ` +
        `Ensure the package has a valid "require" export condition in package.json and exports CommonJS-compatible code.`
      );
      if (stack) this.logger.debug(stack);
      throw new Error(
        `Failed to require piece ${packageName}: ${reason}. ` +
        `Location: ${pluginInfo.location}. ` +
        `Verify the package exports a valid CommonJS module.`
      );
    }
  }
}

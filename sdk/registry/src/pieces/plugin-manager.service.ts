import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';
import { PluginSandbox } from './sandbox.js';

const execAsync = promisify(exec);

export interface InstalledSlot {
  readonly location: string;
  readonly version: string;
}

export function encodePackageName(packageName: string): string {
  return packageName.split('/').join('__').replace(/@/g, '_at_');
}

export function resolvePackageEntry(
  pkgJson: Readonly<{
    main?: string;
    exports?: Record<string, unknown>;
  }>,
): string {
  const dot = pkgJson.exports?.['.'];
  if (typeof dot === 'string') return dot;
  if (dot !== null && typeof dot === 'object') {
    const dotObj = dot as Record<string, unknown>;
    if (typeof dotObj['require'] === 'string') return dotObj['require'];
    if (typeof dotObj['default'] === 'string') return dotObj['default'];
  }
  return pkgJson.main ?? 'index.js';
}

@Injectable()
export class PluginManagerService implements OnModuleInit {
  private readonly logger = new Logger(PluginManagerService.name);

  private readonly pluginsPath: string;
  private readonly registryUrl: string;

  /**
   * In-process index of currently active plugin slots.
   */
  private readonly installedSlots = new Map<string, InstalledSlot>();

  /** 
   * The static dependencies map (IoC Shared Memory) 
   */
  private readonly staticDependencies: Record<string, unknown>;

  private initPromise: Promise<void> | null = null;

  constructor(private readonly configService: ConfigService) {
    const isDev =
      this.configService.get<string>('NODE_ENV') === 'development' ||
      this.configService.get<string>('DEV_MODE') === 'true';

    const appDataDir =
      this.configService.get<string>('APP_DATA_DIR') ??
      (isDev ? process.cwd() : path.join(os.homedir(), '.soopa'));

    this.pluginsPath =
      this.configService.get<string>('PLUGINS_PATH') ??
      (isDev
        ? path.join(os.tmpdir(), 'soopa-plugins-native')
        : path.join(appDataDir, 'plugins'));

    this.registryUrl =
      this.configService.get<string>('NPM_REGISTRY_URL') ??
      process.env['NPM_REGISTRY_URL'] ??
      'https://registry.npmjs.org/';

    this.logger.log(`Native Plugin store root : ${this.pluginsPath}`);
    this.logger.log(`NPM registry             : ${this.registryUrl}`);

    const hostReq = createRequire(import.meta.url);

    this.staticDependencies = {
      '@soopa/piece-framework': { ...hostReq('@soopa/piece-framework') },
      '@soopa/piece-framework/discovery': {
        ...hostReq('@soopa/piece-framework/discovery'),
      },
      '@soopa/domain-tms': { ...hostReq('@soopa/domain-tms') },
    };
  }

  async onModuleInit(): Promise<void> {}

  async initializePlugins(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = fs.promises.mkdir(this.pluginsPath, { recursive: true, mode: 0o700 })
      .then(() => {})
      .catch((err: unknown) => {
        this.initPromise = null;
        throw err;
      });

    await this.initPromise;
  }

  /**
   * Enterprise Immutable Download:
   * 1. Creates a brand new, isolated directory based on the specific version.
   * 2. Runs npm install strictly inside that directory.
   * 3. Evaluates the code using the Native Sandbox.
   * 4. NEVER deletes the directory if a newer version is published.
   */
  async installPiece(
    packageName: string,
    version: string = 'latest',
  ): Promise<{ version: string; location: string; moduleExports: Record<string, unknown> }> {
    this.logger.log(`Downloading ${packageName}@${version} from ${this.registryUrl}`);

    // If version is 'latest', we must query the registry to resolve the true semver string
    let resolvedVersion = version;
    if (version === 'latest') {
      try {
        const { stdout } = await execAsync(`npm view ${packageName} version --registry=${this.registryUrl}`);
        resolvedVersion = stdout.trim();
        this.logger.debug(`Resolved 'latest' to ${resolvedVersion}`);
      } catch (err: unknown) {
        this.logger.error(`Failed to resolve latest version for ${packageName}: ${String(err)}`);
        throw new Error(`Failed to resolve version for ${packageName}`);
      }
    }

    const encodedName = encodePackageName(packageName);
    // Immutable storage path: /pluginsPath/encodedName/version/
    const versionDir = path.join(this.pluginsPath, encodedName, resolvedVersion);
    const nodeModulesDir = path.join(versionDir, 'node_modules', packageName);

    try {
      // Create immutable directory if it doesn't exist
      await fs.promises.access(versionDir);
      this.logger.log(`Directory ${versionDir} already exists, skipping download.`);
    } catch {
      this.logger.log(`Creating immutable sandbox at ${versionDir}`);
      
      const tmpDir = `${versionDir}.tmp-${Date.now()}`;
      await fs.promises.mkdir(tmpDir, { recursive: true });

      // Create a clean package.json to host the install
      const dummyPkg = {
        name: `${encodedName}-sandbox`,
        version: "1.0.0",
        private: true,
        dependencies: {
          [packageName]: resolvedVersion
        }
      };
      await fs.promises.writeFile(
        path.join(tmpDir, 'package.json'), 
        JSON.stringify(dummyPkg, null, 2)
      );

      // Run npm install to download the plugin and all its dependencies
      try {
        await execAsync(`npm install --no-package-lock --no-audit --no-fund --registry=${this.registryUrl}`, {
          cwd: tmpDir,
        });
        await fs.promises.rename(tmpDir, versionDir);
        this.logger.log(`Successfully installed ${packageName}@${resolvedVersion} to ${versionDir}`);
      } catch (err: unknown) {
        await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to run npm install in ${tmpDir}: ${msg}`);
        throw err;
      }
    }

    // Resolve the entry point path
    const pkgJsonPath = path.join(nodeModulesDir, 'package.json');
    const raw = await fs.promises.readFile(pkgJsonPath, 'utf-8');
    const pkgJson = JSON.parse(raw);
    const relEntry = resolvePackageEntry(pkgJson);
    const entryPath = path.resolve(nodeModulesDir, relEntry);

    // Evaluate in Native Sandbox
    let moduleExports: Record<string, unknown>;
    try {
      moduleExports = PluginSandbox.evaluateModule(entryPath, this.staticDependencies);
      if (!moduleExports || typeof moduleExports !== 'object') {
        throw new Error(`Piece exported a non-object value: ${typeof moduleExports}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Sandbox evaluation failed for ${packageName}: ${msg}`);
      throw new Error(`Failed to require ${packageName}: ${msg}`);
    }

    // Update in-memory slots map
    this.installedSlots.set(packageName, { location: nodeModulesDir, version: resolvedVersion });

    return {
      version: resolvedVersion,
      location: nodeModulesDir,
      moduleExports,
    };
  }

  getPieceInfo(packageName: string): InstalledSlot | undefined {
    return this.installedSlots.get(packageName);
  }

  async ensurePiece(
    packageName: string,
    version: string = 'latest',
  ): Promise<{ version: string; location: string; moduleExports: Record<string, unknown> }> {
    const existing = this.getPieceInfo(packageName);

    // Skip network if the exact requested version is already active in memory
    if (existing && version !== 'latest' && existing.version === version) {
      this.logger.debug(
        `${packageName} already at ${existing.location} — skipping download.`,
      );

      const pkgJsonPath = path.join(existing.location, 'package.json');
      const raw = await fs.promises.readFile(pkgJsonPath, 'utf-8');
      const relEntry = resolvePackageEntry(JSON.parse(raw));
      const entryPath = path.resolve(existing.location, relEntry);

      // We MUST evaluate the module through the sandbox again to ensure 
      // static dependencies are injected perfectly.
      const moduleExports = PluginSandbox.evaluateModule(entryPath, this.staticDependencies);

      return {
        version: existing.version,
        location: existing.location,
        moduleExports,
      };
    }

    this.logger.log(`Installing ${packageName} from NPM registry...`);
    return await this.installPiece(packageName, version);
  }
}

import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { pathToFileURL } from 'url';
import * as path from 'path';
import * as fs from 'fs';
import { PIECE_REPOSITORY, type IPieceRepository } from './piece-repository.port.js';

@Injectable()
export class LocalDevPluginSyncService implements OnModuleInit {
  private readonly logger = new Logger(LocalDevPluginSyncService.name);
  private workspacePieces = new Map<string, string>();
  private initialized = false;

  constructor(
    @Inject(PIECE_REPOSITORY) private readonly pieceRepo: IPieceRepository,
  ) {}

  async onModuleInit() {
    // Only automatically called by NestJS if provided in the module (dev only)
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const isDev = process.env.NODE_ENV === 'development' || process.env.DEV_MODE === 'true';
    const disableSync = process.env.DISABLE_LOCAL_SYNC === 'true';
    
    if (!isDev || disableSync) {
      this.initialized = true;
      return;
    }

    this.logger.log(`Startup Sync: Scanning workspace plugins directory...`);
    try {
      let pluginsWorkspaceDir = path.resolve(process.cwd(), 'plugins');
      if (!fs.existsSync(pluginsWorkspaceDir)) {
        pluginsWorkspaceDir = path.resolve(process.cwd(), '../../plugins');
      }

      if (!fs.existsSync(pluginsWorkspaceDir)) {
        this.logger.warn(`Startup Sync: Could not locate plugins directory at ${pluginsWorkspaceDir}`);
        return;
      }

      const categories = await fs.promises.readdir(pluginsWorkspaceDir);
      for (const category of categories) {
        const categoryPath = path.join(pluginsWorkspaceDir, category);
        const stat = await fs.promises.stat(categoryPath);
        if (!stat.isDirectory()) continue;

        const pieceDirs = await fs.promises.readdir(categoryPath);
        for (const pieceDir of pieceDirs) {
          const piecePath = path.join(categoryPath, pieceDir);
          const pieceStat = await fs.promises.stat(piecePath);
          if (!pieceStat.isDirectory()) continue;

          const pkgJsonPath = path.join(piecePath, 'package.json');
          try {
            await fs.promises.access(pkgJsonPath);
            const pkg = JSON.parse(await fs.promises.readFile(pkgJsonPath, 'utf8'));

            if (pkg.name && pkg.name.startsWith('@soopa/')) {
              try {
                const entryPoint = pkg.main || 'dist/index.js';
                const absolutePath = path.resolve(piecePath, entryPoint);
                const exported = await import(pathToFileURL(absolutePath).href);

                this.workspacePieces.set(pkg.name, absolutePath);

                let pieceDef: Record<string, unknown> | null = null;

                for (const [key, val] of Object.entries(exported)) {
                  let maybePiece = val;
                  if (typeof val === 'function' && key === 'register') {
                    try {
                      maybePiece = val();
                    } catch (e) {
                      // ignore
                    }
                  }

                  if (key === 'default' && val !== null && typeof val === 'object') {
                    const defaultObj = val as Record<string, unknown>;
                    if (typeof defaultObj.register === 'function') {
                      try {
                        maybePiece = defaultObj.register();
                      } catch (e) {
                        // ignore
                      }
                    }
                  }

                  if (typeof maybePiece === 'object' && maybePiece !== null && 'name' in maybePiece && 'displayName' in maybePiece) {
                    pieceDef = maybePiece as Record<string, unknown>;
                    break;
                  }
                }

                if (pieceDef) {
                  await this.pieceRepo.upsertPiece({
                    name: String(pieceDef.name),
                    displayName: String(pieceDef.displayName),
                    packageName: pkg.name,
                    version: pkg.version || 'local',
                    logoUrl: typeof pieceDef.logoUrl === 'string' ? pieceDef.logoUrl : undefined,
                  });
                  this.logger.log(`Upserted piece metadata for ${pieceDef.name} (${pkg.name})`);
                }
              } catch (importErr) {
                this.logger.warn(`Failed to natively import piece ${pkg.name} for sync: ${importErr}`);
              }
            }
          } catch (e) {
            // Not a package directory
          }
        }
      }
      this.initialized = true;
      this.logger.log(`Startup Sync: Found ${this.workspacePieces.size} pieces: ${Array.from(this.workspacePieces.keys()).join(', ')}`);
    } catch (err) {
      this.logger.warn(`Startup Sync: Failed to scan workspace plugins directory: ${err}`);
    }
  }

  getWorkspacePiecePath(packageName: string): string | undefined {
    return this.workspacePieces.get(packageName);
  }
}

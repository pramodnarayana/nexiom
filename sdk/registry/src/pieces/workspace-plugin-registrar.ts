import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { pathToFileURL } from 'url';
import * as path from 'path';
import * as fs from 'fs';
import { PIECE_REPOSITORY, type IPieceRepository } from './piece-repository.port.js';
import { extractPieceMetadata } from './piece-metadata.util.js';

@Injectable()
export class WorkspacePluginRegistrar implements OnModuleInit {
  private readonly logger = new Logger(WorkspacePluginRegistrar.name);
  private workspacePieces = new Map<string, string>();
  private initialized = false;

  constructor(
    @Inject(PIECE_REPOSITORY) private readonly pieceRepo: IPieceRepository,
  ) {}

  async onModuleInit() {
    // Only automatically called by NestJS if provided in the module (dev only)
  }

  private initPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    await this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
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

                const pieceDef = extractPieceMetadata(exported);

                if (pieceDef) {
                  await this.pieceRepo.upsertPiece({
                    ...pieceDef,
                    packageName: pkg.name,
                    version: pkg.version || 'local',
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

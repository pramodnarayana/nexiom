import { Injectable, Logger } from '@nestjs/common';
import { pathToFileURL } from 'url';
import type { IPieceResolver } from './piece-resolver.port.js';
import { WorkspaceSyncService } from './workspace-sync.service.js';

/**
 * Development adapter for {@link IPieceResolver}.
 *
 * Uses the {@link WorkspaceSyncService} to locate and load piece packages directly
 * from their absolute paths on the local filesystem. This completely bypasses
 * Node.js package resolution and NPM registries, making it perfectly suited for
 * local monorepo development where pnpm symlinking isolates `import(pkgName)`.
 *
 * Registered by {@link PiecesModule} only when NODE_ENV is development.
 */
@Injectable()
export class DevelopmentPieceResolver implements IPieceResolver {
  private readonly logger = new Logger(DevelopmentPieceResolver.name);

  constructor(private readonly workspaceSync: WorkspaceSyncService) {}

  async resolve(packageName: string): Promise<Record<string, unknown>> {
    const workspacePath = this.workspaceSync.getWorkspacePiecePath(packageName);
    if (!workspacePath) {
      throw new Error(`Piece ${packageName} is not found in the local workspace plugins directory.`);
    }

    this.logger.debug(`Resolving piece ${packageName} natively from workspace cache.`);
    return await import(pathToFileURL(workspacePath).href);
  }
}

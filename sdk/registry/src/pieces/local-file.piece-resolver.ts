import { Injectable, Logger } from '@nestjs/common';
import { pathToFileURL } from 'url';
import * as path from 'path';
import type { IPieceResolver } from './piece-resolver.port.js';
import { WorkspacePluginRegistrar } from './workspace-plugin-registrar.js';

/**
 * Development adapter for {@link IPieceResolver}.
 *
 * Uses the {@link WorkspacePluginRegistrar} to locate and load piece packages directly
 * from their absolute paths on the local filesystem. This completely bypasses
 * Node.js package resolution and NPM registries, making it perfectly suited for
 * local monorepo development where pnpm symlinking isolates `import(pkgName)`.
 *
 * Registered by {@link PiecesModule} only when NODE_ENV is development.
 */
@Injectable()
export class LocalFilePieceResolver implements IPieceResolver {
  private readonly logger = new Logger(LocalFilePieceResolver.name);

  constructor(private readonly localRegistrar: WorkspacePluginRegistrar) {}

  async resolve(packageName: string): Promise<Record<string, unknown>> {
    await this.localRegistrar.initialize();
    const localPath = this.localRegistrar.getWorkspacePiecePath(packageName);

    if (!localPath) {
      throw new Error(
        `[DevResolver] Local source not found for ${packageName}. Ensure it exists in the plugins/ folder.`,
      );
    }

    try {
      this.logger.debug(
        `[DevResolver] Hot-loading ${packageName} from ${localPath}`,
      );
      // We use pathToFileURL because Windows paths will break dynamic imports
      // if passed as raw C:\ paths.
      const moduleUrl = pathToFileURL(path.resolve(localPath)).href;

      // Bust the ES module cache in Node by appending a timestamp to the import query
      // This is necessary because unlike CommonJS require(), dynamic import() caches heavily.
      const bustedUrl = `${moduleUrl}?update=${Date.now()}`;
      return await import(bustedUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `[DevResolver] Failed to natively import local piece ${packageName} from ${localPath}: ${msg}`,
      );
    }
  }
}

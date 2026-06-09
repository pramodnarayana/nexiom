import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { createRequire } from 'node:module';

/**
 * Enterprise Piece Execution Worker
 * 
 * This file is the entrypoint for the Piscina Worker Pool.
 * It executes untrusted third-party integration code inside an isolated Node.js Worker Thread
 * to prevent the main event loop from blocking (DoS protection).
 */

interface ExecutionData {
  scriptPath: string;
  triggerName: string;
  payload: any;
}

export default async function runIntegrationPiece(data: ExecutionData): Promise<any> {
  const { scriptPath, triggerName, payload } = data;
  
  try {
    // ---------------------------------------------------------
    // ENTERPRISE SECURITY: Path Traversal Validation
    // ---------------------------------------------------------
    // Ensure the requested script path physically resides within the allowed
    // plugin sandbox directory or the workspace fallback.
    const resolvedPath = fs.realpathSync(path.resolve(scriptPath));

    // Define and canonicalize allowed roots
    // Reuse the same plugin-root logic as PluginManagerService to ensure consistency
    const isDev = process.env.NODE_ENV === 'development' || process.env.DEV_MODE === 'true';
    const appDataDir = process.env.APP_DATA_DIR || (isDev ? process.cwd() : path.join(os.homedir(), '.soopa'));
    const pluginsPath = process.env.PLUGINS_PATH || (isDev ? path.join(os.tmpdir(), 'soopa-plugins') : path.join(appDataDir, 'plugins'));

    const allowedRoots: string[] = [];

    // Only canonicalize pluginsPath if it exists
    if (fs.existsSync(pluginsPath)) {
      try {
        allowedRoots.push(fs.realpathSync(pluginsPath));
      } catch {
        // If realpathSync fails, skip this root
      }
    }

    // Workspace package roots for local development
    const workspaceRoots = [
      path.join(process.cwd(), 'packages/pieces/platform'),
      path.join(process.cwd(), 'packages/pieces/application'),
    ];

    for (const p of workspaceRoots) {
      if (fs.existsSync(p)) {
        try {
          allowedRoots.push(fs.realpathSync(p));
        } catch {
          // If realpathSync fails, skip this root
        }
      }
    }

    // Validate that resolvedPath has one of the allowed roots as a strict prefix
    const isAllowed = allowedRoots.some(root => {
      const relative = path.relative(root, resolvedPath);
      // Path is safe if relative path doesn't start with '..' (escaping parent) and isn't absolute
      return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    });

    if (!isAllowed) {
      throw new Error(`SECURITY ALERT: Sandbox violation detected. Path traversal attempted: ${resolvedPath}`);
    }

    // Dynamically require the managed bundle from the disk
    // Create a scoped require for ESM compatibility
    const scopedRequire = createRequire(import.meta.url);
    const piece = scopedRequire(resolvedPath);
    
    // Locate the trigger (handling both default export and named export variations)
    const trigger = piece.default?.triggers?.[triggerName] || piece.triggers?.[triggerName];
    
    if (!trigger) {
      throw new Error(`Trigger ${triggerName} not found in piece ${scriptPath}`);
    }

    // Execute the piece logic with the payload
    const result = await trigger.run({ payload });
    return result;
  } catch (error: any) {
    // Piscina automatically forwards errors back to the main thread
    throw new Error(`Integration Error: ${error.message}`);
  }
}

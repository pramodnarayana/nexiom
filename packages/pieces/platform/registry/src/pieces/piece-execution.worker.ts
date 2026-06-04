import * as path from 'node:path';

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
    const resolvedPath = path.resolve(scriptPath);
    const isLocalWorkspace = resolvedPath.includes('/packages/pieces/platform/') || resolvedPath.includes('/packages/pieces/application/');
    const isGlobalPlugins = resolvedPath.startsWith('/tmp/soopa-plugins/') || resolvedPath.startsWith('/tmp/plugin');
    
    if (!isLocalWorkspace && !isGlobalPlugins) {
      throw new Error(`SECURITY ALERT: Sandbox violation detected. Path traversal attempted: ${resolvedPath}`);
    }

    // Dynamically require the managed bundle from the disk
    // Using __non_webpack_require__ or dynamic import if using a bundler
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const piece = require(resolvedPath);
    
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

import * as vm from 'vm';
import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'module';

export class PluginSandbox {
  private static readonly contextGlobals = {
    console,
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,
    URL,
    URLSearchParams,
  };

  /**
   * Evaluates a CommonJS module inside a secure V8 isolate context recursively.
   *
   * @param entryFilePath The absolute path to the module's entry file
   * @param staticDependencies A map of module names to their evaluated exports
   */
  static evaluateModule(
    entryFilePath: string,
    staticDependencies: Record<string, unknown>,
    moduleCache: Record<string, { exports: Record<string, unknown> }> = {}
  ): Record<string, unknown> {
    if (moduleCache[entryFilePath]) {
      return moduleCache[entryFilePath].exports;
    }

    const code = fs.readFileSync(entryFilePath, 'utf-8');
    const moduleObj = { exports: {} as Record<string, unknown> };
    moduleCache[entryFilePath] = moduleObj;

    const scopedRequire = createRequire(entryFilePath);
    
    const sandboxRequire = (id: string) => {
      // 1. Check static dependencies (IoC Shared Memory)
      if (staticDependencies[id]) {
        return staticDependencies[id];
      }

      // 2. Resolve the exact file path
      let resolvedPath: string;
      try {
        resolvedPath = scopedRequire.resolve(id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Sandbox require failed to resolve '${id}' from '${entryFilePath}': ${msg}`);
      }

      // 3. Whitelist Node.js built-in modules - only allow safe modules
      const safeBuiltins = new Set([
        'util', 'path', 'url', 'querystring', 'crypto', 'assert',
        'events', 'stream', 'buffer', 'string_decoder', 'timers'
      ]);

      if (resolvedPath === id) {
        // This is a Node.js built-in module
        if (!safeBuiltins.has(id)) {
          throw new Error(`Sandbox security violation: access to built-in module '${id}' is not allowed`);
        }
        return scopedRequire(id);
      }

      // 4. Allow native addons and JSON files
      if (resolvedPath.endsWith('.node') || resolvedPath.endsWith('.json')) {
        return scopedRequire(id);
      }

      // 5. If it's a regular JS file (whether local or in node_modules), recursively sandbox it!
      // This ensures files inside the plugin ALSO get the static dependencies.
      return this.evaluateModule(resolvedPath, staticDependencies, moduleCache);
    };

    sandboxRequire.resolve = scopedRequire.resolve;
    sandboxRequire.cache = scopedRequire.cache;
    sandboxRequire.extensions = scopedRequire.extensions;
    sandboxRequire.main = scopedRequire.main;

    const wrapper = [
      '(function (exports, require, module, __filename, __dirname) { ',
      code,
      '\n});'
    ].join('');

    const script = new vm.Script(wrapper, {
      filename: entryFilePath,
    });

    const context = vm.createContext({
      ...this.contextGlobals,
      global: this.contextGlobals,
    });

    // Apply timeout to script compilation and execution
    // The timeout option for runInContext applies to the script execution
    const compiledWrapper = script.runInContext(context, { timeout: 10000 });

    // Execute the compiled wrapper function
    // Note: The VM timeout above covers script evaluation within the context,
    // but synchronous blocking in the wrapper function itself is still subject to that timeout
    try {
      compiledWrapper(
        moduleObj.exports,
        sandboxRequire,
        moduleObj,
        entryFilePath,
        path.dirname(entryFilePath)
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to evaluate module ${entryFilePath}: ${msg}`);
    }

    return moduleObj.exports;
  }
}

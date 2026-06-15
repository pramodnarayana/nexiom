import * as vm from 'vm';
import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'module';

export class PluginSandbox {
  private static readonly contextGlobals = {
    console,
    Buffer,
    process,
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

      // 3. If it's a Node built-in module (like 'fs', 'path') or a native C++ addon (.node) or JSON
      if (resolvedPath === id || resolvedPath.endsWith('.node') || resolvedPath.endsWith('.json')) {
        return scopedRequire(id);
      }

      // 4. If it's a regular JS file (whether local or in node_modules), recursively sandbox it!
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

    const compiledWrapper = script.runInContext(context);

    compiledWrapper(
      moduleObj.exports,
      sandboxRequire,
      moduleObj,
      entryFilePath,
      path.dirname(entryFilePath)
    );

    return moduleObj.exports;
  }
}

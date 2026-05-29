import { Test } from '@nestjs/testing';
import { afterEach, afterAll } from 'vitest';
import type { TestingModuleBuilder, TestingModule } from '@nestjs/testing';
import type { ModuleMetadata } from '@nestjs/common';

const originalCreateTestingModule = Test.createTestingModule.bind(
  Test,
) as typeof Test.createTestingModule;
const createdModules = new Set<TestingModule>();

// Patching nestjs/testing
Test.createTestingModule = (metadata: ModuleMetadata): TestingModuleBuilder => {
  const moduleBuilder = originalCreateTestingModule(metadata);
  const originalCompile = moduleBuilder.compile.bind(
    moduleBuilder,
  ) as () => Promise<TestingModule>;

  moduleBuilder.compile = async (): Promise<TestingModule> => {
    const compiledModule = await originalCompile();
    createdModules.add(compiledModule);
    return compiledModule;
  };

  return moduleBuilder;
};

afterEach(async () => {
  for (const module of createdModules) {
    try {
      await module.close();
    } catch (_e) {
      // ignore
    }
  }
  createdModules.clear();
});

afterAll(() => {
  setTimeout(() => {
    const processAny = process as unknown as {
      _getActiveHandles?: () => unknown[];
    };
    if (typeof processAny._getActiveHandles !== 'function') return;

    const handles = processAny._getActiveHandles();
    if (handles.length > 0) {
      console.error('HANGING HANDLES DETECTED:');
      handles.forEach((h: unknown) => {
        if (h && typeof h === 'object') {
          const obj = h as Record<string, unknown>;
          console.error('- Type:', obj.constructor?.name || typeof h);
          if (obj.constructor?.name === 'Socket' && obj._peername) {
            console.error('  Socket to:', obj._peername);
          } else if (obj.constructor?.name === 'Server') {
            console.error('  Server listening:', obj._connectionKey);
          } else if (obj.constructor?.name === 'Timeout') {
            console.error('  Timeout:', obj._idleTimeout, 'ms');
          }
        }
      });
    }
  }, 2000).unref();
});

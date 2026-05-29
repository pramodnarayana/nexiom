import { Test } from "@nestjs/testing";
import { afterEach } from "vitest";
import type { TestingModuleBuilder, TestingModule } from "@nestjs/testing";
import type { ModuleMetadata } from "@nestjs/common";

const originalCreateTestingModule = Test.createTestingModule.bind(Test);
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

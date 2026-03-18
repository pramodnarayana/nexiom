import { describe, it, expect } from "vitest";
import { QueueModule } from "./queue.module.js";
import { QUEUE_SERVICE, QUEUE_MODULE_OPTIONS } from "./constants.js";
import type { FactoryProvider } from "@nestjs/common";

describe("QueueModule.forRootAsync", () => {
  it("returns a global dynamic module", () => {
    const mod = QueueModule.forRootAsync({
      useFactory: () => ({ infraMode: "local" }),
    });

    expect(mod.module).toBe(QueueModule);
    expect(mod.exports).toContain(QUEUE_SERVICE);
  });

  it("registers QUEUE_MODULE_OPTIONS with the provided factory and inject", () => {
    const factory = () => ({ infraMode: "local" as const });
    const inject = ["CONFIG_SERVICE"];

    const mod = QueueModule.forRootAsync({ useFactory: factory, inject });

    const providers = mod.providers as FactoryProvider[];
    const optsProv = providers.find((p) => p.provide === QUEUE_MODULE_OPTIONS)!;
    expect(optsProv.useFactory).toBe(factory);
    expect(optsProv.inject).toEqual(inject);
  });

  it("defaults inject and imports to empty arrays when omitted", () => {
    const mod = QueueModule.forRootAsync({
      useFactory: () => ({ infraMode: "local" as const }),
    });

    expect(mod.imports).toEqual([]);
    const providers = mod.providers as FactoryProvider[];
    const optsProv = providers.find((p) => p.provide === QUEUE_MODULE_OPTIONS)!;
    expect(optsProv.inject).toEqual([]);
  });

  it("registers QueueService under the QUEUE_SERVICE token", () => {
    const mod = QueueModule.forRootAsync({
      useFactory: () => ({ infraMode: "local" as const }),
    });

    const providers = mod.providers as FactoryProvider[];
    const svcProv = providers.find((p) => p.provide === QUEUE_SERVICE);
    expect(svcProv).toBeDefined();
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { ProcessActiveFetchUseCase } from "./process-active-fetch.use-case.js";
import { FakeDataSourceRepository } from "../../fakes/fake-data-source.repository.js";
import { FakePipelineHookBroker } from "../../fakes/fake-pipeline-hook-broker.js";

describe("ProcessActiveFetchUseCase", () => {
  let repository: FakeDataSourceRepository;
  let hookBroker: FakePipelineHookBroker;
  let useCase: ProcessActiveFetchUseCase;

  beforeEach(() => {
    repository = new FakeDataSourceRepository();
    hookBroker = new FakePipelineHookBroker();
    useCase = new ProcessActiveFetchUseCase(repository, hookBroker);
  });

  it("should trigger active fetch via hook broker", async () => {
    repository.dataSources.set("ds-1", {
      appName: "salesforce",
      appProfile: "standard",
    });

    await useCase.execute("trace-1", "ds-1", [
      { entityType: "Contact", sourceId: "ext-1" },
    ]);

    expect(hookBroker.triggeredFetches).toHaveLength(1);
    expect(hookBroker.triggeredFetches[0]).toEqual({
      appName: "salesforce",
      appProfile: "standard",
      missingDependencies: [{ entityType: "Contact", sourceId: "ext-1" }],
      dataSourceId: "ds-1",
    });
  });

  it("should throw if data source is not found", async () => {
    await expect(useCase.execute("trace-1", "ds-missing", [])).rejects.toThrow(
      "Data source ds-missing not found",
    );
  });
});

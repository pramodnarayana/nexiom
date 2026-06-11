import { PipelineHookBrokerService } from "../sharding/pipeline-hook-broker.service.js";
import { Test, TestingModule } from "@nestjs/testing";
import { TargetBuilderService } from "./target-builder.service.js";
import { DATABASE_CONNECTION } from "@soopa/database";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("TargetBuilderService", () => {
  let service: TargetBuilderService;
  let hookBrokerBuildTarget: ReturnType<typeof vi.fn>;

  const SCHEMA = "ws_test";
  const APP = "mock-app";
  const PROFILE = "revenova";
  const TYPE = "TMS_CARRIER";
  const ENTITY_ID = "001abc";
  const NORMALIZED_DATA = { displayName: "ACME Carrier", phone: "555-0100" };
  const RULES = [{ src: "$.displayName", dest: "$.DisplayName" }];


  beforeEach(async () => {
    hookBrokerBuildTarget = vi.fn().mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TargetBuilderService,
        { provide: DATABASE_CONNECTION, useValue: {} },
        {
          provide: PipelineHookBrokerService,
          useValue: { buildTarget: hookBrokerBuildTarget },
        },
      ],
    }).compile();

    service = module.get<TargetBuilderService>(TargetBuilderService);
  });

  afterEach(() => vi.clearAllMocks());

  it("returns mapped payload directly when hookBroker returns empty context", async () => {
    hookBrokerBuildTarget.mockResolvedValue({});

    const result = await service.buildPayload(
      SCHEMA,
      APP,
      PROFILE,
      TYPE,
      ENTITY_ID,
      NORMALIZED_DATA,
      RULES,
    );

    expect(result).toEqual({ DisplayName: "ACME Carrier" });
  });

  it("merges enrichment context and applies rules correctly", async () => {
    const enrichment = {
      tp: { mcNumber: "MC123456" },
      remitTo: { displayName: "Factor Co" },
    };
    hookBrokerBuildTarget.mockResolvedValue(enrichment);
    const enrichedRules = [...RULES, { src: "$.tp.mcNumber", dest: "$.McNumber" }];

    const result = await service.buildPayload(
      SCHEMA,
      APP,
      PROFILE,
      TYPE,
      ENTITY_ID,
      NORMALIZED_DATA,
      enrichedRules,
    );

    expect(result).toEqual({ DisplayName: "ACME Carrier", McNumber: "MC123456" });
  });

  it("falls back to normalizedData and logs warning when hookBroker.buildTarget throws", async () => {
    const warnSpy = vi.spyOn(service["logger"], "warn");
    hookBrokerBuildTarget.mockRejectedValue(new Error("DB join failed"));

    const result = await service.buildPayload(
      SCHEMA,
      APP,
      PROFILE,
      TYPE,
      ENTITY_ID,
      NORMALIZED_DATA,
      RULES,
    );

    expect(result).toEqual({ DisplayName: "ACME Carrier" });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "target_builder.hook_failed" }),
      expect.any(String),
    );
  });

  it("falls back gracefully when hookBroker.buildTarget throws a non-Error value", async () => {
    const warnSpy = vi.spyOn(service["logger"], "warn");
    hookBrokerBuildTarget.mockRejectedValue("raw string error");

    const result = await service.buildPayload(
      SCHEMA,
      APP,
      PROFILE,
      TYPE,
      ENTITY_ID,
      NORMALIZED_DATA,
      RULES,
    );

    expect(result).toEqual({ DisplayName: "ACME Carrier" });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "target_builder.hook_failed" }),
      expect.any(String),
    );
  });

  it("skips hookBroker.buildTarget call when srcEntityId is undefined", async () => {
    await service.buildPayload(
      SCHEMA,
      APP,
      PROFILE,
      TYPE,
      undefined,
      NORMALIZED_DATA,
      RULES,
    );

    expect(hookBrokerBuildTarget).not.toHaveBeenCalled();
  });

  it("throws an error when mapping rules are empty", async () => {
    await expect(
      service.buildPayload(
        SCHEMA,
        APP,
        PROFILE,
        TYPE,
        ENTITY_ID,
        NORMALIZED_DATA,
        [],
      ),
    ).rejects.toThrowError(/No mapping rules configured/);
  });
});

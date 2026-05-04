import { Test, TestingModule } from "@nestjs/testing";
import { TargetBuilderService } from "./target-builder.service.js";
import { DATABASE_CONNECTION } from "@nexiom/database";
import { PipelineHookBrokerService } from "@nexiom/engine";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@nexiom/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexiom/engine")>();
  return {
    ...actual,
    hydratePayload: vi
      .fn()
      .mockImplementation((_rules: unknown, data: unknown) => data),
  };
});

describe("TargetBuilderService", () => {
  let service: TargetBuilderService;
  let db: Record<string, ReturnType<typeof vi.fn>>;
  let hookBrokerBuildTarget: ReturnType<typeof vi.fn>;

  const SCHEMA = "ws_test";
  const APP = "salesforce";
  const PROFILE = "revenova";
  const TYPE = "TMS_CARRIER";
  const ENTITY_ID = "001abc";
  const NORMALIZED_DATA = { displayName: "ACME Carrier", phone: "555-0100" };
  const RULES = [{ src: "$.displayName", dest: "$.DisplayName" }];

  beforeEach(async () => {
    hookBrokerBuildTarget = vi.fn().mockResolvedValue({});
    db = { select: vi.fn(), transaction: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TargetBuilderService,
        { provide: DATABASE_CONNECTION, useValue: db },
        {
          provide: PipelineHookBrokerService,
          useValue: { buildTarget: hookBrokerBuildTarget },
        },
      ],
    }).compile();

    service = module.get<TargetBuilderService>(TargetBuilderService);
  });

  afterEach(() => vi.clearAllMocks());

  it("returns normalizedData directly when hookBroker returns empty context", async () => {
    hookBrokerBuildTarget.mockResolvedValue({});

    const result = await service.buildPayload(
      SCHEMA,
      APP,
      PROFILE,
      TYPE,
      ENTITY_ID,
      NORMALIZED_DATA,
      [],
    );

    expect(result).toEqual(NORMALIZED_DATA);
  });

  it("merges enrichment context from hookBroker.buildTarget", async () => {
    const enrichment = {
      tp: { mcNumber: "MC123456" },
      remitTo: { displayName: "Factor Co" },
    };
    hookBrokerBuildTarget.mockResolvedValue(enrichment);

    const result = await service.buildPayload(
      SCHEMA,
      APP,
      PROFILE,
      TYPE,
      ENTITY_ID,
      NORMALIZED_DATA,
      [],
    );

    expect(result).toMatchObject({ ...NORMALIZED_DATA, ...enrichment });
  });

  it("applies field mapping rules via hydratePayload after enrichment", async () => {
    const { hydratePayload } = await import("@nexiom/engine");
    hookBrokerBuildTarget.mockResolvedValue({ extra: "field" });

    await service.buildPayload(
      SCHEMA,
      APP,
      PROFILE,
      TYPE,
      ENTITY_ID,
      NORMALIZED_DATA,
      RULES,
    );

    expect(vi.mocked(hydratePayload)).toHaveBeenCalledWith(
      RULES,
      expect.objectContaining({ ...NORMALIZED_DATA, extra: "field" }),
    );
  });

  it("falls back to normalizedData when hookBroker.buildTarget returns empty context", async () => {
    hookBrokerBuildTarget.mockResolvedValue({});

    const result = await service.buildPayload(
      SCHEMA,
      APP,
      PROFILE,
      TYPE,
      ENTITY_ID,
      NORMALIZED_DATA,
      [],
    );

    expect(result).toEqual(NORMALIZED_DATA);
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
      [],
    );

    expect(result).toEqual(NORMALIZED_DATA);
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
      [],
    );

    expect(result).toEqual(NORMALIZED_DATA);
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
      [],
    );

    expect(hookBrokerBuildTarget).not.toHaveBeenCalled();
  });

  it("returns enrichedContext unchanged when rules array is empty", async () => {
    const { hydratePayload } = await import("@nexiom/engine");
    hookBrokerBuildTarget.mockResolvedValue({ extra: "x" });

    const result = await service.buildPayload(
      SCHEMA,
      APP,
      PROFILE,
      TYPE,
      ENTITY_ID,
      NORMALIZED_DATA,
      [],
    );

    // No rules → return merged context directly (hydratePayload not called)
    expect(result).toMatchObject({ ...NORMALIZED_DATA, extra: "x" });
    expect(vi.mocked(hydratePayload)).not.toHaveBeenCalled();
  });
});

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from "@nestjs/testing";
import { TargetBuilderService } from "./target-builder.service.js";
import { DATABASE_CONNECTION } from "@nexiom/database";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as appHooks from "@nexiom/piece-framework";

vi.mock("@nexiom/piece-framework", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@nexiom/piece-framework")>();
  return { ...actual, getTargetBuilder: vi.fn() };
});

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
  let db: any;

  const SCHEMA = "ws_test";
  const APP = "salesforce";
  const PROFILE = "revenova";
  const TYPE = "TMS_CARRIER";
  const ENTITY_ID = "001abc";
  const NORMALIZED_DATA = { displayName: "ACME Carrier", phone: "555-0100" };
  const RULES = [{ src: "$.displayName", dest: "$.DisplayName" }];

  beforeEach(async () => {
    vi.mocked(appHooks.getTargetBuilder).mockReset();

    db = { select: vi.fn(), transaction: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TargetBuilderService,
        { provide: DATABASE_CONNECTION, useValue: db },
      ],
    }).compile();

    service = module.get<TargetBuilderService>(TargetBuilderService);
  });

  afterEach(() => vi.clearAllMocks());

  it("returns normalizedData directly when no app builder is registered", async () => {
    vi.mocked(appHooks.getTargetBuilder).mockReturnValue(undefined);

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

  it("merges enrichment context from registered app builder", async () => {
    const enrichment = {
      tp: { mcNumber: "MC123456" },
      remitTo: { displayName: "Factor Co" },
    };
    vi.mocked(appHooks.getTargetBuilder).mockReturnValue(
      vi.fn().mockResolvedValue(enrichment),
    );

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
    vi.mocked(appHooks.getTargetBuilder).mockReturnValue(
      vi.fn().mockResolvedValue({ extra: "field" }),
    );

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

  it("falls back to normalizedData when app builder returns empty context", async () => {
    vi.mocked(appHooks.getTargetBuilder).mockReturnValue(
      vi.fn().mockResolvedValue({}),
    );

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

  it("falls back to normalizedData and logs warning when app builder throws", async () => {
    const warnSpy = vi.spyOn(service["logger"], "warn");
    vi.mocked(appHooks.getTargetBuilder).mockReturnValue(
      vi.fn().mockRejectedValue(new Error("DB join failed")),
    );

    // Should not throw — falls back gracefully
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

  it("skips app builder call when srcEntityId is undefined", async () => {
    const builderFn = vi.fn().mockResolvedValue({ tp: {} });
    vi.mocked(appHooks.getTargetBuilder).mockReturnValue(builderFn);

    await service.buildPayload(
      SCHEMA,
      APP,
      PROFILE,
      TYPE,
      undefined,
      NORMALIZED_DATA,
      [],
    );

    expect(builderFn).not.toHaveBeenCalled();
  });

  it("returns enrichedContext unchanged when rules array is empty", async () => {
    const { hydratePayload } = await import("@nexiom/engine");
    vi.mocked(appHooks.getTargetBuilder).mockReturnValue(
      vi.fn().mockResolvedValue({ extra: "x" }),
    );

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

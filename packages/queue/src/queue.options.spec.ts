import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConfigService } from "@nestjs/config";
import { createQueueModuleOptions } from "./queue.options.js";

const makeCfg = (env: Record<string, string>) =>
  ({
    get: vi.fn((key: string, fallback?: string) => env[key] ?? fallback),
  }) as unknown as ConfigService;

describe("createQueueModuleOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns local options with defaults when INFRA_MODE=local", () => {
    const cfg = makeCfg({
      INFRA_MODE: "local",
      SQS_ENDPOINT: "http://localhost:4566",
      AWS_ACCOUNT_ID: "000000000000",
    });

    const opts = createQueueModuleOptions(cfg);

    expect(opts.infraMode).toBe("local");
    expect(opts.endpoint).toBe("http://localhost:4566");
    expect(opts.region).toBe("us-east-1"); // default
    expect(opts.accountId).toBe("000000000000");
    expect(opts.enabled).toBe(true); // default
  });

  it("returns production options when INFRA_MODE=production", () => {
    const cfg = makeCfg({
      INFRA_MODE: "production",
      AWS_REGION: "eu-west-1",
      AWS_ACCOUNT_ID: "123456789012",
    });

    const opts = createQueueModuleOptions(cfg);

    expect(opts.infraMode).toBe("production");
    expect(opts.region).toBe("eu-west-1");
    expect(opts.accountId).toBe("123456789012");
    expect(opts.enabled).toBe(true);
  });

  it("sets enabled=false when QUEUE_ENABLED=false", () => {
    const cfg = makeCfg({
      INFRA_MODE: "local",
      QUEUE_ENABLED: "false",
    });

    const opts = createQueueModuleOptions(cfg);

    expect(opts.enabled).toBe(false);
  });

  it("throws when INFRA_MODE is an invalid value", () => {
    const cfg = makeCfg({ INFRA_MODE: "staging" });

    expect(() => createQueueModuleOptions(cfg)).toThrow("Invalid INFRA_MODE");
  });

  it("defaults INFRA_MODE to local when not set", () => {
    const cfg = makeCfg({});

    const opts = createQueueModuleOptions(cfg);

    expect(opts.infraMode).toBe("local");
  });
});

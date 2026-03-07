/* eslint-disable */

import { describe, it, expect, vi } from "vitest";
import { TextEncoder, TextDecoder } from "util";
import * as nodeCrypto from "crypto";

Object.defineProperty(global, "TextEncoder", {
  writable: true,
  value: TextEncoder,
});
Object.defineProperty(global, "TextDecoder", {
  writable: true,
  value: TextDecoder,
});
Object.defineProperty(global, "crypto", {
  writable: true,
  value: nodeCrypto,
});

vi.mock("better-auth", () => ({
  betterAuth: vi.fn(() => ({
    api: {},
    handler: {},
  })),
}));
vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: vi.fn(),
}));
vi.mock("better-auth/plugins", () => ({
  organization: vi.fn(),
  admin: vi.fn(),
}));
vi.mock("better-auth/node", () => ({
  fromNodeHeaders: vi.fn(),
}));

vi.mock("./adapters/better-auth.adapter", () => ({
  BetterAuthAdapter: class { },
}));
vi.mock("./adapters/drizzle-user.adapter", () => ({
  DrizzleUserAdapter: class { },
}));
vi.mock("./adapters/drizzle-tenant.adapter", () => ({
  DrizzleTenantAdapter: class { },
}));
vi.mock("./adapters/drizzle-permission.adapter", () => ({
  DrizzlePermissionAdapter: class { },
}));

describe("Identity Package", () => {
  it("should export adapters", async () => {
    const IdentityPackage = await import("./index.js");

    expect(IdentityPackage).toBeDefined();

    expect((IdentityPackage as any).BetterAuthAdapter).toBeDefined();

    expect((IdentityPackage as any).DrizzleUserAdapter).toBeDefined();

    expect((IdentityPackage as any).DrizzleTenantAdapter).toBeDefined();

    expect((IdentityPackage as any).DrizzlePermissionAdapter).toBeDefined();
  });
});

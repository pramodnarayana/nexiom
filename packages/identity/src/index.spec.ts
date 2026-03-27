/* eslint-disable */

import { describe, it, expect, vi } from "vitest";
import { TextEncoder, TextDecoder } from "util";
import * as nodeCrypto from "crypto";
import * as IdentityPackage from "./index.js";

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

vi.mock("./adapters/better-auth.adapter.js", () => ({
  BetterAuthAdapter: class { },
}));
vi.mock("./adapters/drizzle-user.adapter.js", () => ({
  DrizzleUserAdapter: class { },
}));
vi.mock("./adapters/drizzle-tenant.adapter.js", () => ({
  DrizzleTenantAdapter: class { },
}));
vi.mock("./adapters/drizzle-permission.adapter.js", () => ({
  DrizzlePermissionAdapter: class { },
}));

describe("Identity Package", () => {
  it("should export adapters", () => {
    expect(IdentityPackage).toBeDefined();

    expect((IdentityPackage as any).BetterAuthAdapter).toBeDefined();

    expect((IdentityPackage as any).DrizzleUserAdapter).toBeDefined();

    expect((IdentityPackage as any).DrizzleTenantAdapter).toBeDefined();

    expect((IdentityPackage as any).DrizzlePermissionAdapter).toBeDefined();
  });
});

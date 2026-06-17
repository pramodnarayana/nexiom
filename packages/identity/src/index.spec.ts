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

vi.mock("./adapters/outbound/better-auth.adapter.js", () => ({
  BetterAuthAdapter: class { },
}));
vi.mock("./adapters/outbound/drizzle-user.adapter.js", () => ({
  DrizzleUserRepositoryAdapter: class { },
}));
vi.mock("./adapters/outbound/drizzle-tenant.adapter.js", () => ({
  DrizzleTenantRepositoryAdapter: class { },
}));
vi.mock("./adapters/outbound/drizzle-permission.adapter.js", () => ({
  DrizzlePermissionRepositoryAdapter: class { },
}));
vi.mock("./adapters/outbound/drizzle-role.adapter.js", () => ({
  DrizzleRoleRepositoryAdapter: class { },
}));

describe("Identity Package", () => {
  it("should export package symbols", () => {
    expect(IdentityPackage).toBeDefined();

    // Adapters
    expect((IdentityPackage as any).BetterAuthAdapter).toBeDefined();
    expect((IdentityPackage as any).DrizzleUserRepositoryAdapter).toBeDefined();
    expect((IdentityPackage as any).DrizzleTenantRepositoryAdapter).toBeDefined();
    expect((IdentityPackage as any).DrizzlePermissionRepositoryAdapter).toBeDefined();
    expect((IdentityPackage as any).DrizzleRoleRepositoryAdapter).toBeDefined();

    // Use Cases
    expect((IdentityPackage as any).ListUsersWithInvitationsUseCase).toBeDefined();
    expect((IdentityPackage as any).RemoveUserUseCase).toBeDefined();
    expect((IdentityPackage as any).GetUserProfileUseCase).toBeDefined();
    expect((IdentityPackage as any).CreateUserUseCase).toBeDefined();
    expect((IdentityPackage as any).GetUserByIdUseCase).toBeDefined();

    // Exceptions
    expect((IdentityPackage as any).UserNotFoundError).toBeDefined();
    expect((IdentityPackage as any).TenantNotFoundError).toBeDefined();
  });
});

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

jest.mock("better-auth", () => ({
  betterAuth: jest.fn(() => ({
    api: {},
    handler: {},
  })),
}));
jest.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: jest.fn(),
}));
jest.mock("better-auth/plugins", () => ({
  organization: jest.fn(),
  admin: jest.fn(),
}));
jest.mock("better-auth/node", () => ({
  fromNodeHeaders: jest.fn(),
}));

jest.mock("./adapters/better-auth.adapter", () => ({
  BetterAuthAdapter: class { },
}));
jest.mock("./adapters/drizzle-user.adapter", () => ({
  DrizzleUserAdapter: class { },
}));
jest.mock("./adapters/drizzle-tenant.adapter", () => ({
  DrizzleTenantAdapter: class { },
}));
jest.mock("./adapters/drizzle-permission.adapter", () => ({
  DrizzlePermissionAdapter: class { },
}));

describe("Identity Package", () => {
  it("should export adapters", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
    const IdentityPackage = require("./index");

    expect(IdentityPackage).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(IdentityPackage.BetterAuthAdapter).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(IdentityPackage.DrizzleUserAdapter).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(IdentityPackage.DrizzleTenantAdapter).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(IdentityPackage.DrizzlePermissionAdapter).toBeDefined();
  });
});

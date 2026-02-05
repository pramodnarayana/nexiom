import { describe, it, expect } from "vitest";
import { IdentityModule, IdentityModuleOptions } from "./identity.module";
import {
  AUTH_PROVIDER,
  USER_PROVIDER,
  TENANT_PROVIDER,
  PERMISSION_PROVIDER,
  IDENTITY_OPTIONS,
} from "./constants";

import type { DynamicModule, FactoryProvider } from "@nestjs/common";

const mkOptions = () => ({
  betterAuthConfig: {
    allowedOrigins: ["http://localhost"],
    betterAuthUrl: "http://localhost/api/auth",
  },
  dbToken: Symbol("DB"),
  emailToken: Symbol("EMAIL"),
});

describe("IdentityModule.register", () => {
  it("throws if tokens missing", () => {
    const opts = mkOptions();
    expect(() =>
      IdentityModule.register({ betterAuthConfig: opts.betterAuthConfig }),
    ).toThrow("required");
  });

  it("wires providers and exports tokens", () => {
    const opts = mkOptions();
    const mod: DynamicModule = IdentityModule.register(opts);

    expect(mod.module).toBe(IdentityModule);
    // Verify all expected providers are registered
    const providers = (mod.providers || []) as FactoryProvider[];

    const tokens = providers.map((p) => p.provide);
    expect(tokens).toContain(AUTH_PROVIDER);
    expect(tokens).toContain(USER_PROVIDER);
    expect(tokens).toContain(TENANT_PROVIDER);
    expect(tokens).toContain(PERMISSION_PROVIDER);

    // exports contain tokens
    expect(mod.exports).toContain(AUTH_PROVIDER);
    expect(mod.exports).toContain(USER_PROVIDER);
    expect(mod.exports).toContain(TENANT_PROVIDER);
    expect(mod.exports).toContain(PERMISSION_PROVIDER);

    // factories inject requested tokens
    const authProv = providers.find((p) => p.provide === AUTH_PROVIDER);
    // AUTH_PROVIDER now needs TENANT_PROVIDER injected
    expect(authProv?.inject).toEqual([
      opts.dbToken,
      opts.emailToken,
      TENANT_PROVIDER,
    ]);

    const userProv = providers.find((p) => p.provide === USER_PROVIDER);
    expect(userProv?.inject).toEqual([opts.dbToken, AUTH_PROVIDER]);
    const tenantProv = providers.find((p) => p.provide === TENANT_PROVIDER);
    expect(tenantProv?.inject).toEqual([opts.dbToken]);
    const permProv = providers.find((p) => p.provide === PERMISSION_PROVIDER);
    expect(permProv?.inject).toEqual([opts.dbToken]);
  });

  it("registerAsync wires providers correctly", () => {
    const opts = mkOptions();
    const mod = IdentityModule.registerAsync({
      imports: [],
      useFactory: () =>
        ({
          betterAuthConfig: opts.betterAuthConfig,
          db: {} as unknown,
          email: {} as unknown,
        }) as unknown as IdentityModuleOptions,
      inject: [],
    });

    expect(mod.module).toBe(IdentityModule);
    expect(mod.providers).toBeDefined();
    expect(mod.providers?.length).toBeGreaterThan(0);
    // Verify exported providers
    expect(mod.exports).toContain(AUTH_PROVIDER);
  });

  it("registerAsync throws if db or email missing in options", async () => {
    const mod = IdentityModule.registerAsync({
      imports: [],
      useFactory: () =>
        ({
          betterAuthConfig: mkOptions().betterAuthConfig,
          // Missing db and email
        }) as unknown as IdentityModuleOptions,
      inject: [],
    });

    // Find the options provider by token instead of index-based access
    const providers = mod.providers as FactoryProvider[];
    const optionsProvider = providers.find(
      (p) => p.provide === "IDENTITY_OPTIONS",
    );

    expect(optionsProvider).toBeDefined();
    // We expect the factory to throw
    await expect(optionsProvider!.useFactory()).rejects.toThrow(
      "must be provided",
    );
  });

  it("registerAsync handles default imports/inject", () => {
    // Tests defaults || []
    const mod = IdentityModule.registerAsync({
      useFactory: () => ({}) as unknown as IdentityModuleOptions,
      // omit imports and inject
    });
    expect(mod.imports).toEqual([]);
    const optionsProvider = (mod.providers as FactoryProvider[]).find(
      (p) => p.provide === IDENTITY_OPTIONS,
    );
    expect(optionsProvider?.inject).toEqual([]);
  });
});

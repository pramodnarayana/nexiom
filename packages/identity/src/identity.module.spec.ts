import { describe, it, expect } from "vitest";
import { IdentityModule, IdentityModuleOptions } from "./identity.module.js";
import {
  AUTH_PROVIDER,
  USER_REPOSITORY,
  TENANT_REPOSITORY,
  PERMISSION_REPOSITORY,
  ROLE_REPOSITORY,
  IDENTITY_OPTIONS,
} from "./constants.js";
import { BetterAuthAdapter } from "./adapters/outbound/better-auth.adapter.js";
import { DrizzleUserRepositoryAdapter } from "./adapters/outbound/drizzle-user.repository.js";
import { DrizzleTenantRepositoryAdapter } from "./adapters/outbound/drizzle-tenant.repository.js";
import { DrizzlePermissionRepositoryAdapter } from "./adapters/outbound/drizzle-permission.repository.js";
import { DrizzleRoleRepositoryAdapter } from "./adapters/outbound/drizzle-role.repository.js";

import type {
  DynamicModule,
  FactoryProvider,
  ClassProvider,
} from "@nestjs/common";

const mkOptions = () => ({
  betterAuthConfig: {
    allowedOrigins: ["http://localhost"],
    betterAuthUrl: "http://localhost/api/auth",
  },
  dbToken: Symbol("DB"),
  emailToken: Symbol("EMAIL"),
  constants: {
    systemTenantId: "system",
    ownerRoleId: "owner",
    adminRoleId: "admin",
    memberRoleId: "member",
  },
});

describe("IdentityModule.register", () => {
  it("throws if tokens missing", () => {
    const opts = mkOptions();
    expect(() =>
      IdentityModule.register({
        betterAuthConfig: opts.betterAuthConfig,
        constants: opts.constants,
        // missing tokens
      } as unknown as IdentityModuleOptions),
    ).toThrow("required");
  });

  it("throws if constants missing", () => {
    const opts = mkOptions();
    expect(() =>
      IdentityModule.register({
        betterAuthConfig: opts.betterAuthConfig,
        dbToken: opts.dbToken,
        emailToken: opts.emailToken,
        // missing constants
      } as unknown as IdentityModuleOptions),
    ).toThrow("constants are required");
  });

  it("wires providers and exports tokens", () => {
    const opts = mkOptions();
    const mod: DynamicModule = IdentityModule.register(opts);

    expect(mod.module).toBe(IdentityModule);
    // Verify all expected providers are registered
    const providers = (mod.providers || []) as (
      | FactoryProvider
      | ClassProvider
    )[];

    const tokens = providers.map((p) => p.provide);
    expect(tokens).toContain(AUTH_PROVIDER);
    expect(tokens).toContain(USER_REPOSITORY);
    expect(tokens).toContain(TENANT_REPOSITORY);
    expect(tokens).toContain(PERMISSION_REPOSITORY);
    expect(tokens).toContain(ROLE_REPOSITORY);

    // exports contain tokens
    expect(mod.exports).toContain(AUTH_PROVIDER);
    expect(mod.exports).toContain(USER_REPOSITORY);
    expect(mod.exports).toContain(TENANT_REPOSITORY);
    expect(mod.exports).toContain(PERMISSION_REPOSITORY);
    expect(mod.exports).toContain(ROLE_REPOSITORY);

    // factories inject requested tokens
    // Verify providers use correct classes
    const assertClassProvider = (
      token: string | symbol,
      name: string,
    ): ClassProvider => {
      const prov = providers.find((p) => p.provide === token);
      if (!prov || !("useClass" in prov)) {
        throw new Error(`${name} should be a ClassProvider`);
      }
      return prov;
    };

    // Verify providers use correct classes with safe type narrowing
    const authProv = assertClassProvider(AUTH_PROVIDER, "AUTH_PROVIDER");
    expect(authProv.useClass).toBe(BetterAuthAdapter);

    const userProv = assertClassProvider(USER_REPOSITORY, "USER_REPOSITORY");
    expect(userProv.useClass).toBe(DrizzleUserRepositoryAdapter);

    const tenantProv = assertClassProvider(
      TENANT_REPOSITORY,
      "TENANT_REPOSITORY",
    );
    expect(tenantProv.useClass).toBe(DrizzleTenantRepositoryAdapter);

    const permProv = assertClassProvider(
      PERMISSION_REPOSITORY,
      "PERMISSION_REPOSITORY",
    );
    expect(permProv.useClass).toBe(DrizzlePermissionRepositoryAdapter);

    const roleProv = assertClassProvider(ROLE_REPOSITORY, "ROLE_REPOSITORY");
    expect(roleProv.useClass).toBe(DrizzleRoleRepositoryAdapter);
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
      (p) => p.provide === IDENTITY_OPTIONS,
    );

    expect(optionsProvider).toBeDefined();
    // We expect the factory to throw
    await expect(optionsProvider!.useFactory()).rejects.toThrow(
      "must be provided",
    );
  });

  it("registerAsync throws if constants missing", async () => {
    const mod = IdentityModule.registerAsync({
      imports: [],
      useFactory: () =>
        ({
          betterAuthConfig: mkOptions().betterAuthConfig,
          db: {} as unknown,
          email: {} as unknown,
          // Missing constants
        }) as unknown as IdentityModuleOptions,
      inject: [],
    });

    const providers = mod.providers as FactoryProvider[];
    const optionsProvider = providers.find(
      (p) => p.provide === IDENTITY_OPTIONS,
    );

    expect(optionsProvider).toBeDefined();
    await expect(optionsProvider!.useFactory()).rejects.toThrow(
      "constants must be provided",
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

/* eslint-disable */
import { describe, it, expect, vi } from "vitest";
import { IdentityModule } from "./identity.module";
import {
  AUTH_PROVIDER,
  USER_PROVIDER,
  TENANT_PROVIDER,
  PERMISSION_PROVIDER,
} from "./constants";

import type { DynamicModule } from "@nestjs/common";

const mkOptions = () => ({
  betterAuthConfig: {
    allowedOrigins: ["http://localhost"],
    betterAuthUrl: "http://localhost/api/auth",
  },
  dbToken: Symbol("DB"),
  emailToken: Symbol("EMAIL"),
});

describe("IdentityModule.register", () => {
  it("wires providers and exports tokens", () => {
    const opts = mkOptions();
    const mod: DynamicModule = IdentityModule.register(opts);

    expect(mod.module).toBe(IdentityModule);
    // providers include all 4
    const providers = (mod.providers || []) as any[];
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
    expect(authProv.inject).toEqual([opts.dbToken, opts.emailToken, TENANT_PROVIDER]);

    const userProv = providers.find((p) => p.provide === USER_PROVIDER);
    expect(userProv.inject).toEqual([opts.dbToken, AUTH_PROVIDER]);
    const tenantProv = providers.find((p) => p.provide === TENANT_PROVIDER);
    expect(tenantProv.inject).toEqual([opts.dbToken]);
    const permProv = providers.find((p) => p.provide === PERMISSION_PROVIDER);
    expect(permProv.inject).toEqual([opts.dbToken]);
  });
});

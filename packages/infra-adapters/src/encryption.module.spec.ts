import { describe, it, expect } from "vitest";
import { EncryptionModule } from "./encryption.module.js";
import { ENCRYPTION_SERVICE, ENCRYPTION_MODULE_OPTIONS } from "./constants.js";
import { LocalCryptoAdapter } from "./adapters/local-crypto.adapter.js";
import { AwsKmsAdapter } from "./adapters/aws-kms.adapter.js";
import type { FactoryProvider } from "@nestjs/common";

const KEY_32 = "a".repeat(32);

/** Extracts the ENCRYPTION_SERVICE factory provider and calls it with opts. */
function resolveAdapter(
  mod: ReturnType<typeof EncryptionModule.forRootAsync>,
  opts: unknown,
) {
  const providers = mod.providers as FactoryProvider[];
  const svcProv = providers.find((p) => p.provide === ENCRYPTION_SERVICE)!;
  return (svcProv.useFactory as (o: unknown) => unknown)(opts);
}

describe("EncryptionModule.forRootAsync", () => {
  it("returns a global dynamic module that exports ENCRYPTION_SERVICE", () => {
    const mod = EncryptionModule.forRootAsync({
      useFactory: () => ({ mode: "local", encryptionKey: KEY_32 }),
    });

    expect(mod.global).toBe(true);
    expect(mod.module).toBe(EncryptionModule);
    expect(mod.exports).toContain(ENCRYPTION_SERVICE);
  });

  it("defaults inject and imports to empty arrays", () => {
    const mod = EncryptionModule.forRootAsync({
      useFactory: () => ({ mode: "local", encryptionKey: KEY_32 }),
    });

    expect(mod.imports).toEqual([]);
    const providers = mod.providers as FactoryProvider[];
    const optsProv = providers.find(
      (p) => p.provide === ENCRYPTION_MODULE_OPTIONS,
    )!;
    expect(optsProv.inject).toEqual([]);
  });

  describe("adapter factory", () => {
    it('returns a LocalCryptoAdapter when mode = "local"', () => {
      const mod = EncryptionModule.forRootAsync({
        useFactory: () => ({ mode: "local", encryptionKey: KEY_32 }),
      });
      expect(
        resolveAdapter(mod, { mode: "local", encryptionKey: KEY_32 }),
      ).toBeInstanceOf(LocalCryptoAdapter);
    });

    it('returns an AwsKmsAdapter when mode = "kms"', () => {
      const mod = EncryptionModule.forRootAsync({
        useFactory: () => ({ mode: "kms", kmsKeyId: "alias/test" }),
      });
      expect(
        resolveAdapter(mod, { mode: "kms", kmsKeyId: "alias/test" }),
      ).toBeInstanceOf(AwsKmsAdapter);
    });

    it('throws when mode = "local" but encryptionKey is missing', () => {
      const mod = EncryptionModule.forRootAsync({
        useFactory: () => ({ mode: "local" }),
      });
      expect(() => resolveAdapter(mod, { mode: "local" })).toThrow(
        "encryptionKey",
      );
    });

    it('throws when mode = "kms" but kmsKeyId is missing', () => {
      const mod = EncryptionModule.forRootAsync({
        useFactory: () => ({ mode: "kms" }),
      });
      expect(() => resolveAdapter(mod, { mode: "kms" })).toThrow("kmsKeyId");
    });

    it("throws on unknown mode", () => {
      const mod = EncryptionModule.forRootAsync({
        useFactory: () => ({ mode: "local" }),
      });
      expect(() => resolveAdapter(mod, { mode: "azure-vault" })).toThrow(
        "unknown mode",
      );
    });
  });
});

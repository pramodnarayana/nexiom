import { describe, it, expect } from "vitest";
import { LocalCryptoAdapter } from "./adapters/local-crypto.adapter.js";

const KEY_32 = "a".repeat(32);

describe("LocalCryptoAdapter", () => {
  const adapter = new LocalCryptoAdapter({ encryptionKey: KEY_32 });

  describe("constructor", () => {
    it("throws if key is shorter than 32 bytes", () => {
      expect(
        () => new LocalCryptoAdapter({ encryptionKey: "tooshort" }),
      ).toThrow("32 bytes");
    });

    it("throws if key is longer than 32 bytes", () => {
      expect(
        () => new LocalCryptoAdapter({ encryptionKey: "a".repeat(33) }),
      ).toThrow("32 bytes");
    });
  });

  describe("encrypt()", () => {
    it("produces iv:authTag:ciphertext wire format", async () => {
      const parts = (await adapter.encrypt("hello")).split(":");
      expect(parts).toHaveLength(3);
      expect(parts[0]).toHaveLength(24); // 12-byte iv → 24 hex chars
      expect(parts[1]).toHaveLength(32); // 16-byte auth tag → 32 hex chars
    });

    it("does not embed the plaintext in the ciphertext", async () => {
      const secret = "super-secret-token";
      const cipher = await adapter.encrypt(secret);
      expect(cipher).not.toContain(secret);
    });

    it("produces different ciphertext each call (random IV)", async () => {
      const c1 = await adapter.encrypt("same");
      const c2 = await adapter.encrypt("same");
      expect(c1).not.toBe(c2);
    });
  });

  describe("decrypt()", () => {
    it("round-trips arbitrary plaintext", async () => {
      const plain = JSON.stringify({
        accessToken: "tok_abc",
        refreshToken: "ref_xyz",
      });
      expect(await adapter.decrypt(await adapter.encrypt(plain))).toBe(plain);
    });

    it("throws on tampered ciphertext (wrong auth tag)", async () => {
      const cipher = await adapter.encrypt("hello");
      // Flip first char of the auth tag segment
      const parts = cipher.split(":");
      parts[1] = (parts[1].startsWith("a") ? "b" : "a") + parts[1].slice(1);
      await expect(adapter.decrypt(parts.join(":"))).rejects.toThrow(
        "Decryption failed",
      );
    });

    it("throws on malformed ciphertext (missing segments)", async () => {
      await expect(adapter.decrypt("notvalid")).rejects.toThrow(
        "Decryption failed",
      );
    });
  });
});

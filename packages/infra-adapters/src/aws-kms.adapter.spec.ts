import { describe, it, expect, vi, beforeEach } from "vitest";
import { AwsKmsAdapter } from "./adapters/aws-kms.adapter.js";

// ---------------------------------------------------------------------------
// Mock @aws-sdk/client-kms — no real network calls in unit tests
// ---------------------------------------------------------------------------
const mockSend = vi.fn();
vi.mock("@aws-sdk/client-kms", () => ({
  KMSClient: vi.fn(function (this: any) {
    this.send = mockSend;
  }),

  EncryptCommand: vi.fn(function (this: any, input: unknown) {
    Object.assign(this, input);
    this._type = "EncryptCommand";
  }),

  DecryptCommand: vi.fn(function (this: any, input: unknown) {
    Object.assign(this, input);
    this._type = "DecryptCommand";
  }),
}));

describe("AwsKmsAdapter", () => {
  let adapter: AwsKmsAdapter;

  beforeEach(() => {
    mockSend.mockReset();
    adapter = new AwsKmsAdapter({
      keyId: "alias/nexiom-test",
      region: "us-east-1",
    });
  });

  describe("encrypt()", () => {
    it("returns base64-encoded ciphertext from KMS CiphertextBlob", async () => {
      const blob = Buffer.from("kms-ciphertext-bytes");
      mockSend.mockResolvedValueOnce({ CiphertextBlob: blob });

      const result = await adapter.encrypt("plaintext");
      expect(result).toBe(blob.toString("base64"));
    });

    it('throws "Encryption failed" when KMS returns no blob', async () => {
      mockSend.mockResolvedValueOnce({ CiphertextBlob: undefined });
      await expect(adapter.encrypt("x")).rejects.toThrow("Encryption failed");
    });

    it('throws "Encryption failed" on KMS error', async () => {
      mockSend.mockRejectedValueOnce(new Error("KMS unavailable"));
      await expect(adapter.encrypt("x")).rejects.toThrow("Encryption failed");
    });
  });

  describe("decrypt()", () => {
    it("returns utf-8 plaintext from KMS Plaintext", async () => {
      const plain = "decrypted-secret";
      mockSend.mockResolvedValueOnce({ Plaintext: Buffer.from(plain) });

      const b64 = Buffer.from("fake-cipher").toString("base64");
      expect(await adapter.decrypt(b64)).toBe(plain);
    });

    it('throws "Decryption failed" when KMS returns no plaintext', async () => {
      mockSend.mockResolvedValueOnce({ Plaintext: undefined });
      await expect(adapter.decrypt("aGVsbG8=")).rejects.toThrow(
        "Decryption failed",
      );
    });

    it('throws "Decryption failed" on KMS error', async () => {
      mockSend.mockRejectedValueOnce(new Error("AccessDenied"));
      await expect(adapter.decrypt("aGVsbG8=")).rejects.toThrow(
        "Decryption failed",
      );
    });
  });
});

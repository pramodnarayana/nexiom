import { Injectable, Logger } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { IEncryptionService } from "../interfaces/encryption-service.interface.js";

export interface LocalCryptoAdapterOptions {
  /** Exactly 32-byte raw string key for AES-256-GCM. */
  encryptionKey: string;
}

/**
 * AES-256-GCM local encryption adapter for development and testing.
 *
 * Wire format: `<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 * - iv:       12 bytes → 24 hex chars
 * - authTag:  16 bytes → 32 hex chars
 *
 * This format is wire-compatible with the existing `AesEncryptionService`
 * in `packages/connection-manager/src/crypto/`.
 */
@Injectable()
export class LocalCryptoAdapter implements IEncryptionService {
  private readonly logger = new Logger(LocalCryptoAdapter.name);
  private readonly algorithm = "aes-256-gcm" as const;
  private readonly keyBuffer: Buffer;

  constructor(options: LocalCryptoAdapterOptions) {
    if (
      !options?.encryptionKey ||
      typeof options.encryptionKey !== "string" ||
      options.encryptionKey.length === 0
    ) {
      throw new Error("LocalCryptoAdapter: missing or invalid encryptionKey");
    }
    const buf = Buffer.from(options.encryptionKey);
    if (buf.length !== 32) {
      throw new Error(
        `LocalCryptoAdapter: encryptionKey must be exactly 32 bytes, got ${buf.length}`,
      );
    }
    this.keyBuffer = buf;
  }

  encrypt(plaintext: string): Promise<string> {
    try {
      const iv = randomBytes(12);
      const cipher = createCipheriv(this.algorithm, this.keyBuffer, iv);
      let encrypted = cipher.update(plaintext, "utf8", "hex");
      encrypted += cipher.final("hex");
      const authTag = cipher.getAuthTag().toString("hex");
      return Promise.resolve(`${iv.toString("hex")}:${authTag}:${encrypted}`);
    } catch (err) {
      this.logger.error("Encryption failed", err);
      return Promise.reject(new Error("Encryption failed"));
    }
  }

  decrypt(ciphertext: string): Promise<string> {
    try {
      const parts = ciphertext.split(":");
      if (parts.length !== 3) {
        throw new Error(
          "Invalid ciphertext format — expected iv:authTag:ciphertext",
        );
      }
      const [ivHex, authTagHex, encHex] = parts;
      const decipher = createDecipheriv(
        this.algorithm,
        this.keyBuffer,
        Buffer.from(ivHex, "hex"),
      );
      decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
      let decrypted = decipher.update(encHex, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return Promise.resolve(decrypted);
    } catch (err) {
      this.logger.error("Decryption failed", err);
      return Promise.reject(new Error("Decryption failed"));
    }
  }
}

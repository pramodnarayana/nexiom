import { Injectable, Logger } from "@nestjs/common";
import { KMSClient, EncryptCommand, DecryptCommand } from "@aws-sdk/client-kms";
import type { IEncryptionService } from "../interfaces/encryption-service.interface.js";

export interface AwsKmsAdapterOptions {
  /** Full ARN or alias ARN of the KMS key (e.g. 'alias/nexiom-local'). */
  keyId: string;
  /** AWS region. Default: 'us-east-1'. */
  region?: string;
  /**
   * Override endpoint URL.
   * Set to 'http://localhost:4566' to use LocalStack in development.
   */
  endpoint?: string;
}

/**
 * AWS KMS encryption adapter for production (and LocalStack-backed local dev).
 *
 * Ciphertext format: base64-encoded raw KMS `CiphertextBlob`.
 * The key ID is embedded in the blob by AWS, so `decrypt` does not need it
 * for real symmetric CMKs, but LocalStack requires it — we always pass it.
 */
@Injectable()
export class AwsKmsAdapter implements IEncryptionService {
  private readonly logger = new Logger(AwsKmsAdapter.name);
  private readonly client: KMSClient;
  private readonly keyId: string;

  constructor(options: AwsKmsAdapterOptions) {
    this.keyId = options.keyId;
    this.client = new KMSClient({
      region: options.region ?? "us-east-1",
      ...(options.endpoint && {
        endpoint: options.endpoint,
        credentials: { accessKeyId: "test", secretAccessKey: "test" },
      }),
    });
  }

  async encrypt(plaintext: string): Promise<string> {
    try {
      const { CiphertextBlob } = await this.client.send(
        new EncryptCommand({
          KeyId: this.keyId,
          Plaintext: Buffer.from(plaintext, "utf8"),
        }),
      );
      if (!CiphertextBlob) throw new Error("KMS returned no ciphertext blob");
      return Buffer.from(CiphertextBlob).toString("base64");
    } catch (err) {
      this.logger.error("KMS encryption failed", err);
      throw new Error("Encryption failed");
    }
  }

  async decrypt(ciphertext: string): Promise<string> {
    try {
      const { Plaintext } = await this.client.send(
        new DecryptCommand({
          CiphertextBlob: Buffer.from(ciphertext, "base64"),
          // Passed explicitly for LocalStack compatibility
          KeyId: this.keyId,
        }),
      );
      if (!Plaintext) throw new Error("KMS returned no plaintext");
      return Buffer.from(Plaintext).toString("utf8");
    } catch (err) {
      this.logger.error("KMS decryption failed", err);
      throw new Error("Decryption failed");
    }
  }
}

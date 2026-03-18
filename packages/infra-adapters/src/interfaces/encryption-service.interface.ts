export interface IEncryptionService {
  /**
   * Encrypts a plaintext string.
   * Returns an opaque, implementation-specific ciphertext string.
   */
  encrypt(plaintext: string): Promise<string>;

  /**
   * Decrypts a ciphertext string previously produced by `encrypt`.
   * Throws if the ciphertext is invalid or has been tampered with.
   */
  decrypt(ciphertext: string): Promise<string>;
}

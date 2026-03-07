export abstract class EncryptionService {
    abstract decrypt(val: string): Promise<string>;
    abstract encrypt(val: string): Promise<string>;
}

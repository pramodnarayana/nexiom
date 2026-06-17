import type { DynamicModule, ModuleMetadata, Type } from "@nestjs/common";
import { Global, Module } from "@nestjs/common";
import { ENCRYPTION_MODULE_OPTIONS, ENCRYPTION_SERVICE } from "./constants.js";
import { LocalCryptoAdapter } from "./adapters/outbound/local-crypto.adapter.js";
import { AwsKmsAdapter } from "./adapters/outbound/aws-kms.adapter.js";

export interface EncryptionModuleOptions {
  /**
   * 'local' → AES-256-GCM via Node.js crypto (no AWS required).
   * 'kms'   → AWS KMS (works against LocalStack when kmsEndpoint is set).
   */
  mode: "local" | "kms";
  /** Required when mode = 'local'. Exactly 32-byte raw string key. */
  encryptionKey?: string;
  /** Required when mode = 'kms'. Full ARN or alias ARN. */
  kmsKeyId?: string;
  /** AWS region for KMS. Default: 'us-east-1'. */
  region?: string;
  /** Override KMS endpoint (e.g. 'http://localhost:4566' for LocalStack). */
  kmsEndpoint?: string;
}

export interface EncryptionModuleAsyncOptions extends Pick<
  ModuleMetadata,
  "imports"
> {
  useFactory: (
    ...args: unknown[]
  ) => Promise<EncryptionModuleOptions> | EncryptionModuleOptions;
  inject?: (string | symbol | Type<unknown>)[];
}

/**
 * Global NestJS dynamic module for encryption operations.
 *
 * Register once in AppModule:
 * ```typescript
 * EncryptionModule.forRootAsync({
 *   inject: [ConfigService],
 *   useFactory: (cfg: ConfigService) => ({
 *     mode:          cfg.get('INFRA_MODE') === 'local' ? 'local' : 'kms',
 *     encryptionKey: cfg.get('ENCRYPTION_KEY'),
 *     kmsKeyId:      cfg.get('KMS_KEY_ID'),
 *     kmsEndpoint:   cfg.get('KMS_ENDPOINT'),
 *   }),
 * })
 * ```
 *
 * Inject in any service:
 * ```typescript
 * constructor(@Inject(ENCRYPTION_SERVICE) private readonly encryption: IEncryptionService) {}
 * ```
 */
@Global()
@Module({})
export class EncryptionModule {
  static forRootAsync(options: EncryptionModuleAsyncOptions): DynamicModule {
    return {
      global: true,
      module: EncryptionModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: ENCRYPTION_MODULE_OPTIONS,
          useFactory: options.useFactory,

          inject: options.inject ?? [],
        },
        {
          provide: ENCRYPTION_SERVICE,
          useFactory: (opts: EncryptionModuleOptions) => {
            if (opts.mode === "local") {
              if (!opts.encryptionKey) {
                throw new Error(
                  'EncryptionModule: encryptionKey is required when mode is "local"',
                );
              }
              return new LocalCryptoAdapter({
                encryptionKey: opts.encryptionKey,
              });
            }
            if (opts.mode === "kms") {
              if (!opts.kmsKeyId) {
                throw new Error(
                  'EncryptionModule: kmsKeyId is required when mode is "kms"',
                );
              }
              return new AwsKmsAdapter({
                keyId: opts.kmsKeyId,
                region: opts.region,
                endpoint: opts.kmsEndpoint,
              });
            }
            throw new Error(
              `EncryptionModule: unknown mode "${(opts as { mode: string }).mode}"`,
            );
          },
          inject: [ENCRYPTION_MODULE_OPTIONS],
        },
      ],
      exports: [ENCRYPTION_SERVICE],
    };
  }
}

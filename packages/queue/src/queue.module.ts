import type { DynamicModule, ModuleMetadata, Type } from "@nestjs/common";
import { Global, Module } from "@nestjs/common";
import { QUEUE_MODULE_OPTIONS, QUEUE_SERVICE } from "./constants.js";
import { QueueService } from "./queue.service.js";

export interface QueueModuleOptions {
  /** 'local' → LocalStack endpoint. 'production' → real AWS SQS. */
  infraMode: "local" | "production";
  /** AWS region. Default: 'us-east-1'. */
  region?: string;
  /** Override SQS endpoint URL. Required when infraMode = 'local'. */
  endpoint?: string;
  /**
   * AWS account ID used to build queue URLs in production.
   * Typically sourced from SSM or an env var.
   * LocalStack always uses '000000000000'.
   */
  accountId?: string;
}

export interface QueueModuleAsyncOptions extends Pick<
  ModuleMetadata,
  "imports"
> {
  useFactory: (
    ...args: unknown[]
  ) => Promise<QueueModuleOptions> | QueueModuleOptions;
  inject?: (string | symbol | Type<unknown>)[];
}

/**
 * Global NestJS dynamic module for SQS-backed queue operations.
 *
 * Register once in AppModule:
 * ```typescript
 * QueueModule.forRootAsync({
 *   inject: [ConfigService],
 *   useFactory: (cfg: ConfigService) => ({
 *     infraMode: cfg.get('INFRA_MODE'),
 *     endpoint: cfg.get('SQS_ENDPOINT'),
 *     region:   cfg.get('AWS_REGION', 'us-east-1'),
 *     accountId: cfg.get('AWS_ACCOUNT_ID'),
 *   }),
 * })
 * ```
 *
 * Inject in any service:
 * ```typescript
 * constructor(@Inject(QUEUE_SERVICE) private readonly queue: IQueueService) {}
 * ```
 */
@Global()
@Module({})
export class QueueModule {
  static forRootAsync(options: QueueModuleAsyncOptions): DynamicModule {
    return {
      module: QueueModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: QUEUE_MODULE_OPTIONS,
          useFactory: options.useFactory,

          inject: (options.inject ?? []) as any[],
        },
        {
          provide: QUEUE_SERVICE,
          useClass: QueueService,
        },
      ],
      exports: [QUEUE_SERVICE],
    };
  }
}
